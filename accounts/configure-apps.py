#!/usr/bin/env python3
"""Discover the existing Amplify services and configure shared-pool SPA clients."""
import argparse,json,os
from pathlib import Path
from urllib.parse import urlsplit
import boto3
from botocore.exceptions import ClientError

REGION='us-east-2'
POOL='us-east-2_VzCBot5S3'
DOMAIN='us-east-2vzcbot5s3'
GTOTREE_CLIENT='6k3o2d5gtns534fcuqdkqgbto8'
APPS={
 'gtotree':('d3kklav1el26h6','https://main.d3kklav1el26h6.amplifyapp.com/','GTOTREE'),
 'taxonsleuth':('d3p0n8syijshxf','https://main.d3p0n8syijshxf.amplifyapp.com/','AG'),
 'breseq':('d2oabdi4t7olrl','https://main.d2oabdi4t7olrl.amplifyapp.com/','BRESEQ'),
 'fegenie':('d3csq8rzw3uxyt','https://main.d3csq8rzw3uxyt.amplifyapp.com/','FEGENIE'),
 'basil':('d1ey1num28bf43','https://main.d1ey1num28bf43.amplifyapp.com/','BASIL'),
}
HERE=Path(__file__).resolve().parent

def results_bucket(env,prefix):
    direct=env.get(f'VITE_{prefix}_RESULTS_BUCKET')
    if direct:return direct
    host=urlsplit(env.get(f'VITE_{prefix}_PUBLIC_RESULTS','')).hostname or ''
    if '.s3.' in host or '.s3-' in host:return host.split('.s3')[0]
    raise ValueError(f'Could not determine {prefix} results bucket. Set VITE_{prefix}_RESULTS_BUCKET in Amplify first.')

def function_for_url(lam,url):
    wanted=urlsplit(url).netloc
    if not wanted.endswith('.on.aws'):raise ValueError('Expected an existing Lambda Function URL; configure this service manually if using API Gateway.')
    for page in lam.get_paginator('list_functions').paginate():
        for function in page['Functions']:
            try:config=lam.get_function_url_config(FunctionName=function['FunctionName'])
            except lam.exceptions.ResourceNotFoundException:continue
            if urlsplit(config['FunctionUrl']).netloc==wanted:
                variables=lam.get_function_configuration(FunctionName=function['FunctionName']).get('Environment',{}).get('Variables',{})
                if variables.get('PROFILES_TABLE'):raise ValueError('The legacy service URL points to the account service.')
                return function['FunctionName'],function['FunctionArn']
    raise ValueError('No Lambda matches the configured service URL.')

def discover(amp,lam):
    apps={};original={}
    for name,(app_id,url,prefix) in APPS.items():
        app=amp.get_app(appId=app_id)['app'];branch=amp.get_branch(appId=app_id,branchName='main')['branch']
        original[name]={'app_id':app_id,'branch_env':branch.get('environmentVariables',{})}
        env={**app.get('environmentVariables',{}),**branch.get('environmentVariables',{})}
        api=env.get(f'VITE_{prefix}_API_BASE','')
        function,arn=function_for_url(lam,api)
        config={'url':url,'app_id':app_id,'legacyFunction':function,'legacyArn':arn}
        if name=='taxonsleuth':config['searchFunction']=arn
        else:
            variables=lam.get_function_configuration(FunctionName=function).get('Environment',{}).get('Variables',{})
            config['inputBucket']=env.get(f'VITE_{prefix}_INPUT_BUCKET') or variables.get('INPUT_BUCKET','')
            if variables.get('INPUT_BUCKET') and variables['INPUT_BUCKET']!=config['inputBucket']:raise ValueError(f'{name}: Amplify and legacy Lambda input buckets disagree.')
            if not config['inputBucket']:raise ValueError(f'Missing VITE_{prefix}_INPUT_BUCKET in Amplify.')
            config['resultsBucket']=results_bucket(env,prefix)
            for bucket in [config['inputBucket'],config['resultsBucket']]:
                if not bucket or not all(c.islower() or c.isdigit() or c in '.-' for c in bucket):raise ValueError('Invalid bucket configuration.')
        apps[name]=config
        print(f'{name}: {url} -> {function}')
    return apps,original

def pool_clients(cog):
    clients={};token=None
    while True:
        response=cog.list_user_pool_clients(UserPoolId=POOL,MaxResults=60,**({'NextToken':token} if token else {}))
        clients.update({c['ClientName']:c['ClientId'] for c in response['UserPoolClients']})
        token=response.get('NextToken')
        if not token:return clients

def configure_clients(cog,apps):
    existing=pool_clients(cog)
    version=cog.describe_user_pool_domain(Domain=DOMAIN).get('DomainDescription',{}).get('ManagedLoginVersion',1)
    for name,config in apps.items():
        if name=='gtotree':config['clientId']=GTOTREE_CLIENT;continue
        client_name='MAB-'+name
        args={'UserPoolId':POOL,'ClientName':client_name,'CallbackURLs':[config['url']],'LogoutURLs':[config['url']],
              'SupportedIdentityProviders':['COGNITO'],'AllowedOAuthFlowsUserPoolClient':True,'AllowedOAuthFlows':['code'],
              'AllowedOAuthScopes':['openid','email','profile'],'ReadAttributes':['email','email_verified','name'],
              'WriteAttributes':['email','name'],'PreventUserExistenceErrors':'ENABLED'}
        if client_name in existing:
            client_id=existing[client_name]
            current=cog.describe_user_pool_client(UserPoolId=POOL,ClientId=client_id)['UserPoolClient']
            if current.get('ClientSecret'):raise ValueError(f'{client_name} must be a public client without a secret.')
            cog.update_user_pool_client(ClientId=client_id,**args)
        else:client_id=cog.create_user_pool_client(GenerateSecret=False,**args)['UserPoolClient']['ClientId']
        config['clientId']=client_id
        if version==2:
            try:cog.describe_managed_login_branding_by_client(UserPoolId=POOL,ClientId=client_id)
            except cog.exceptions.ResourceNotFoundException:
                cog.create_managed_login_branding(UserPoolId=POOL,ClientId=client_id,UseCognitoProvidedValues=True)
        print(f'{name}: Cognito app client configured')

def parameters(apps):
    extra={name:{k:v for k,v in c.items() if k in {'inputBucket','resultsBucket','searchFunction'}} for name,c in apps.items() if name!='gtotree'}
    inputs=sorted({c['inputBucket'] for c in extra.values() if 'inputBucket' in c})
    results=sorted({c['resultsBucket'] for c in extra.values() if 'resultsBucket' in c})
    return {'InputBucket':apps['gtotree']['inputBucket'],'ResultsBucket':apps['gtotree']['resultsBucket'],'ClientIds':','.join(c['clientId'] for c in apps.values()),'AllowedOrigins':','.join(c['url'].rstrip('/') for c in apps.values()),
            'AppConfig':json.dumps(extra,separators=(',',':')),'AppListArns':','.join('arn:aws:s3:::'+b for b in sorted(set(inputs+results))),
            'AppReadArns':','.join('arn:aws:s3:::'+b+'/*' for b in results),'AppWriteArns':','.join('arn:aws:s3:::'+b+'/*' for b in inputs),
            'TaxonSearchArn':apps['taxonsleuth']['searchFunction']}

def enable_frontends(amp,cloudformation):
    saved=json.loads((HERE/'apps.local.json').read_text())
    outputs=cloudformation.describe_stacks(StackName='mab-accounts')['Stacks'][0]['Outputs']
    api=next(x['OutputValue'] for x in outputs if x['OutputKey']=='AccountApiUrl').rstrip('/')
    for name,config in saved['apps'].items():
        app_id=config['app_id']
        current=amp.get_branch(appId=app_id,branchName='main')['branch'].get('environmentVariables',{})
        env={**current,'VITE_MAB_AUTH_ENABLED':'true','VITE_MAB_API_BASE':api,'VITE_MAB_CLIENT_ID':config['clientId']}
        amp.update_branch(appId=app_id,branchName='main',environmentVariables=env)
        job=amp.start_job(appId=app_id,branchName='main',jobType='RELEASE')['jobSummary']
        print(f'{name}: main redeploy started ({job["jobId"]})')

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');parser.add_argument('--enable-frontends',action='store_true')
    args=parser.parse_args();session=boto3.Session(region_name=REGION)
    amp,lam,cog=session.client('amplify'),session.client('lambda'),session.client('cognito-idp')
    if args.enable_frontends:
        if not args.apply:parser.error('--enable-frontends requires --apply')
        enable_frontends(amp,session.client('cloudformation'));return
    apps,original=discover(amp,lam)
    if not args.apply:print('Read-only discovery complete. Add --apply to configure clients and save deployment settings.');return
    os.umask(0o077)
    backup=HERE/'amplify-before-accounts.local.json'
    if not backup.exists():backup.write_text(json.dumps(original,indent=2)+'\n')
    configure_clients(cog,apps)
    (HERE/'apps.local.json').write_text(json.dumps({'apps':apps},indent=2)+'\n')
    (HERE/'deploy-parameters.local.json').write_text(json.dumps(parameters(apps),indent=2)+'\n')
    print('Saved deployment settings. Existing service endpoints and buckets are unchanged.')

if __name__=='__main__':main()

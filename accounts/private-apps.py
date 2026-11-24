#!/usr/bin/env python3
"""Close legacy anonymous access after authenticated app tests; reversible."""
import argparse,json,os
from datetime import datetime,timezone
from pathlib import Path
import boto3

HERE=Path(__file__).resolve().parent
BLOCK={k:True for k in ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets']}

def inventory(saved):
    apps=saved['apps']
    if set(apps)!={'gtotree','taxonsleuth','fegenie','breseq','basil'}:raise ValueError('Expected all five configured apps.')
    buckets=sorted({c[k] for c in apps.values() for k in ['inputBucket','resultsBucket'] if k in c})
    functions=sorted({c['legacyFunction'] for c in apps.values()})
    return buckets,functions

def restore(s3,lam,saved):
    for name,auth in saved['functions'].items():lam.update_function_url_config(FunctionName=name,AuthType=auth)
    for name,config in saved['buckets'].items():
        if config is None:s3.delete_public_access_block(Bucket=name)
        else:s3.put_public_access_block(Bucket=name,PublicAccessBlockConfiguration=config)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');parser.add_argument('--restore',type=Path)
    args=parser.parse_args();session=boto3.Session(region_name='us-east-2');s3,lam=session.client('s3'),session.client('lambda')
    if args.restore:
        saved=json.loads(args.restore.read_text())
        if not args.apply:print('Read-only. Add --apply to restore the saved access settings.');return
        restore(s3,lam,saved);print('Previous access settings restored.');return
    buckets,functions=inventory(json.loads((HERE/'apps.local.json').read_text()))
    saved={'buckets':{},'functions':{}}
    for name in functions:
        config=lam.get_function_configuration(FunctionName=name)
        if config.get('Environment',{}).get('Variables',{}).get('PROFILES_TABLE'):raise ValueError('Cannot close the authenticated account API.')
        saved['functions'][name]=lam.get_function_url_config(FunctionName=name)['AuthType']
    for bucket in buckets:
        try:saved['buckets'][bucket]=s3.get_public_access_block(Bucket=bucket)['PublicAccessBlockConfiguration']
        except s3.exceptions.ClientError as exc:
            if exc.response['Error']['Code']!='NoSuchPublicAccessBlockConfiguration':raise
            saved['buckets'][bucket]=None
    print('Legacy service URLs to restrict:',', '.join(functions));print('Buckets to make private:',', '.join(buckets))
    if not args.apply:print('Read-only. Test all apps first, then add --apply.');return
    os.umask(0o077)
    directory=HERE/'private-backups';directory.mkdir(exist_ok=True,mode=0o700)
    backup=directory/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.json');backup.write_text(json.dumps(saved,indent=2)+'\n')
    try:
        for name in functions:lam.update_function_url_config(FunctionName=name,AuthType='AWS_IAM')
        for bucket in buckets:s3.put_public_access_block(Bucket=bucket,PublicAccessBlockConfiguration=BLOCK)
    except Exception:
        restore(s3,lam,saved);raise
    print('Anonymous service URLs and direct bucket access are closed. Worker IAM access is preserved.')
    print('Rollback: python3 private-apps.py --restore',backup,'--apply')

if __name__=='__main__':main()

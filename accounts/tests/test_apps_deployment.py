import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import Mock


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parents[1] / filename)
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


setup = module('configure_apps', 'configure-apps.py')
cutover = module('private_apps', 'private-apps.py')


class AppDeploymentTests(unittest.TestCase):
    def configs(self):
        return {name: {'app_id': app_id, 'url': url, 'legacyFunction': name + '-legacy',
                       **({'searchFunction': 'arn:aws:lambda:us-east-2:123456789012:function:taxon-search'} if name == 'taxonsleuth' else
                          {'inputBucket': name + '-input', 'resultsBucket': name + '-results'})}
                for name, (app_id, url, _) in setup.APPS.items()}

    def test_callbacks_use_each_app_and_exclude_hashes(self):
        clients = Mock()
        clients.list_user_pool_clients.return_value = {'UserPoolClients': []}
        clients.describe_user_pool_domain.return_value = {'DomainDescription': {'ManagedLoginVersion': 1}}
        clients.create_user_pool_client.side_effect = lambda **args: {'UserPoolClient': {'ClientId': args['ClientName']}}
        apps = self.configs()
        setup.configure_clients(clients, apps)
        self.assertEqual(clients.create_user_pool_client.call_count, 4)
        for call in clients.create_user_pool_client.call_args_list:
            args = call.kwargs
            self.assertFalse(args['GenerateSecret'])
            self.assertEqual(args['AllowedOAuthFlows'], ['code'])
            self.assertEqual(args['AllowedOAuthScopes'], ['openid', 'email', 'profile'])
            self.assertEqual(args['CallbackURLs'], args['LogoutURLs'])
            self.assertNotIn('#', args['CallbackURLs'][0])
            self.assertNotEqual(args['CallbackURLs'][0], setup.APPS['gtotree'][1])
        self.assertEqual(apps['gtotree']['clientId'], setup.GTOTREE_CLIENT)

    def test_redeployment_reuses_existing_public_clients(self):
        clients = Mock()
        clients.list_user_pool_clients.return_value = {'UserPoolClients': [{'ClientName': 'MAB-' + name, 'ClientId': name} for name in setup.APPS if name != 'gtotree']}
        clients.describe_user_pool_domain.return_value = {'DomainDescription': {'ManagedLoginVersion': 1}}
        clients.describe_user_pool_client.return_value = {'UserPoolClient': {}}
        setup.configure_clients(clients, self.configs())
        clients.create_user_pool_client.assert_not_called()
        self.assertEqual(clients.update_user_pool_client.call_count, 4)
        clients.describe_user_pool_client.return_value = {'UserPoolClient': {'ClientSecret': 'never-use-in-spa'}}
        with self.assertRaises(ValueError):
            setup.configure_clients(clients, self.configs())

    def test_managed_login_branding_is_created_for_version_two_only(self):
        clients = Mock()
        clients.list_user_pool_clients.return_value = {'UserPoolClients': []}
        clients.describe_user_pool_domain.return_value = {'DomainDescription': {'ManagedLoginVersion': 2}}
        clients.create_user_pool_client.side_effect = lambda **args: {'UserPoolClient': {'ClientId': args['ClientName']}}
        clients.exceptions.ResourceNotFoundException = type('ResourceNotFoundException', (Exception,), {})
        clients.describe_managed_login_branding_by_client.side_effect = clients.exceptions.ResourceNotFoundException()
        setup.configure_clients(clients, self.configs())
        self.assertEqual(clients.create_managed_login_branding.call_count, 4)

    def test_stack_parameters_scope_buckets_and_clients_without_result_ownership_rules(self):
        apps = self.configs()
        for name in apps:
            apps[name]['clientId'] = name + '-client'
        params = setup.parameters(apps)
        self.assertEqual(len(params['ClientIds'].split(',')), 5)
        self.assertEqual(set(json.loads(params['AppConfig'])), {'taxonsleuth', 'fegenie', 'breseq', 'basil'})
        self.assertNotIn('*', params['AppListArns'])
        self.assertEqual(params['InputBucket'], 'gtotree-input')
        self.assertTrue(all(arn.endswith('/*') for arn in params['AppReadArns'].split(',')))

    def test_cutover_deduplicates_shared_input_results_buckets_and_restores(self):
        apps = self.configs()
        apps['breseq']['resultsBucket'] = apps['breseq']['inputBucket']
        buckets, functions = cutover.inventory({'apps': apps})
        self.assertEqual(len(buckets), 7)
        self.assertEqual(len(functions), 5)
        with self.assertRaises(ValueError):
            cutover.inventory({'apps': {}})
        s3, lam = Mock(), Mock()
        previous = {'buckets': {'shared': None, 'private': {'BlockPublicAcls': True}}, 'functions': {'old': 'NONE'}}
        cutover.restore(s3, lam, previous)
        lam.update_function_url_config.assert_called_once_with(FunctionName='old', AuthType='NONE')
        s3.delete_public_access_block.assert_called_once_with(Bucket='shared')
        s3.put_public_access_block.assert_called_once_with(Bucket='private', PublicAccessBlockConfiguration={'BlockPublicAcls': True})

    def test_results_bucket_is_explicit_or_verifiable_s3_host(self):
        self.assertEqual(setup.results_bucket({'VITE_BASIL_PUBLIC_RESULTS': 'https://basil-results.s3.us-east-2.amazonaws.com'}, 'BASIL'), 'basil-results')
        with self.assertRaises(ValueError):
            setup.results_bucket({'VITE_BASIL_PUBLIC_RESULTS': 'https://opaque.cloudfront.net'}, 'BASIL')


if __name__ == '__main__':
    unittest.main()

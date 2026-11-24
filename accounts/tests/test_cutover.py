import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

module_path = Path(__file__).resolve().parents[1] / 'activate-private-results.py'
spec = importlib.util.spec_from_file_location('cutover', module_path)
cutover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cutover)


class CutoverTests(unittest.TestCase):
    def clients(self):
        s3, lam = Mock(), Mock()
        original = {'BlockPublicAcls': False, 'IgnorePublicAcls': False,
                    'BlockPublicPolicy': False, 'RestrictPublicBuckets': False}
        s3.get_public_access_block.return_value = {'PublicAccessBlockConfiguration': original}
        lam.get_function_url_config.return_value = {'AuthType': 'NONE', 'FunctionUrl': 'https://old-upload.example'}
        lam.get_function_configuration.return_value = {'Environment': {'Variables': {'INPUT_BUCKET': 'midauthorbio-gtotree-input'}}}
        session = Mock()
        session.client.side_effect = lambda name: {'s3': s3, 'lambda': lam}[name]
        return session, s3, lam, original

    def test_audit_does_not_change_aws_settings(self):
        session, s3, lam, _ = self.clients()
        with patch.object(cutover.boto3, 'Session', return_value=session), patch.object(sys, 'argv', ['cutover', '--legacy-presign-function', 'old-upload']):
            cutover.main()
        s3.put_public_access_block.assert_not_called()
        lam.update_function_url_config.assert_not_called()

    def test_new_accounts_api_or_another_apps_endpoint_cannot_be_disabled(self):
        for variables in [{'INPUT_BUCKET': 'another-bucket'}, {'INPUT_BUCKET': 'midauthorbio-gtotree-input', 'PROFILES_TABLE': 'profiles'}]:
            session, s3, lam, _ = self.clients()
            lam.get_function_configuration.return_value = {'Environment': {'Variables': variables}}
            with patch.object(cutover.boto3, 'Session', return_value=session), patch.object(sys, 'argv', ['cutover', '--legacy-presign-function', 'wrong-function', '--apply']):
                with self.assertRaises(SystemExit):
                    cutover.main()
            s3.put_public_access_block.assert_not_called()
            lam.update_function_url_config.assert_not_called()

    def test_cutover_backs_up_settings_then_only_locks_expected_buckets_and_old_endpoint(self):
        session, s3, lam, original = self.clients()
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(cutover.boto3, 'Session', return_value=session), patch.object(sys, 'argv', ['cutover', '--legacy-presign-function', 'old-upload', '--apply', '--backup-dir', tmp]):
                cutover.main()
            saved = list(Path(tmp).glob('*/settings.json'))
            self.assertEqual(len(saved), 1)
            self.assertEqual(json.loads(saved[0].read_text())['buckets']['midauthorbio-gtotree-results'], original)
            self.assertEqual(saved[0].stat().st_mode & 0o777, 0o600)
        self.assertEqual({call.kwargs['Bucket'] for call in s3.put_public_access_block.call_args_list}, {'midauthorbio-gtotree-input', 'midauthorbio-gtotree-results'})
        for call in s3.put_public_access_block.call_args_list:
            self.assertTrue(all(call.kwargs['PublicAccessBlockConfiguration'].values()))
        lam.update_function_url_config.assert_called_once_with(FunctionName='old-upload', AuthType='AWS_IAM')
        s3.delete_object.assert_not_called()
        s3.put_bucket_policy.assert_not_called()

    def test_failed_cutover_restores_previous_settings(self):
        session, s3, lam, original = self.clients()
        s3.put_public_access_block.side_effect = [None, RuntimeError('simulated failure'), None, None]
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(cutover.boto3, 'Session', return_value=session), patch.object(sys, 'argv', ['cutover', '--legacy-presign-function', 'old-upload', '--apply', '--backup-dir', tmp]):
                with self.assertRaisesRegex(RuntimeError, 'simulated failure'):
                    cutover.main()
        self.assertEqual(s3.put_public_access_block.call_args_list[-1].kwargs['PublicAccessBlockConfiguration'], original)
        self.assertEqual(lam.update_function_url_config.call_args_list[-1].kwargs['AuthType'], 'NONE')

    def test_explicit_restore_reinstates_saved_access_settings(self):
        session, s3, lam, original = self.clients()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'settings.json'
            path.write_text(json.dumps({'buckets': {'midauthorbio-gtotree-input': original, 'midauthorbio-gtotree-results': original}, 'legacy_function': 'old-upload', 'legacy_auth_type': 'NONE'}))
            with patch.object(cutover.boto3, 'Session', return_value=session), patch.object(sys, 'argv', ['cutover', '--restore', str(path), '--apply']):
                cutover.main()
        self.assertEqual(s3.put_public_access_block.call_count, 2)
        self.assertEqual(s3.put_public_access_block.call_args.kwargs['PublicAccessBlockConfiguration'], original)
        lam.update_function_url_config.assert_called_once_with(FunctionName='old-upload', AuthType='NONE')


if __name__ == '__main__':
    unittest.main()

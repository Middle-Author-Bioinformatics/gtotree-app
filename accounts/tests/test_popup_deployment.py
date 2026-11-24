import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class PopupDeploymentTests(unittest.TestCase):
    def run_update(self, parameters):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        shutil.copy(Path(__file__).resolve().parents[1] / 'update-popup-relay.sh', root)
        (root / 'current.json').write_text(json.dumps(parameters))
        (root / 'aws').write_text('#!/bin/sh\nprintf "%s\\n" "$*" > "' + str(root / 'aws-args') + '"\ncat "' + str(root / 'current.json') + '"\n')
        (root / 'aws').chmod(0o755)
        (root / 'deploy.sh').write_text('#!/bin/sh\ncat "$MAB_DEPLOY_PARAMETERS_FILE" > "' + str(root / 'observed.json') + '"\n')
        result = subprocess.run(['bash', str(root / 'update-popup-relay.sh')], env={**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH']}, capture_output=True, text=True)
        return root, result

    def test_update_preserves_live_settings_and_replaces_only_artifact_parameters(self):
        existing = {'ClientIds': 'client1,client2', 'AllowedOrigins': 'https://app1.example,https://app2.example', 'AppConfig': '{"fegenie":{"resultsBucket":"existing"}}', 'ArtifactBucket': 'old-bucket', 'ArtifactKey': 'old.zip', 'UserPoolId': 'existing-pool'}
        root, result = self.run_update([{'ParameterKey': key, 'ParameterValue': value} for key, value in existing.items()])
        self.assertEqual(result.returncode, 0, result.stderr)
        saved = json.loads((root / 'observed.json').read_text())
        self.assertEqual(saved, {key: value for key, value in existing.items() if not key.startswith('Artifact')})
        self.assertIn('describe-stacks --region us-east-2 --stack-name mab-accounts', (root / 'aws-args').read_text())

    def test_missing_existing_configuration_stops_before_deployment(self):
        root, result = self.run_update([{'ParameterKey': 'UserPoolId', 'ParameterValue': 'pool'}])
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((root / 'observed.json').exists())


if __name__ == '__main__':
    unittest.main()

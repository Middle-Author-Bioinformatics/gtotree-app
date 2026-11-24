#!/usr/bin/env python3
"""Final cutover after testing authenticated access; back up settings for rollback."""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import boto3


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    operation = parser.add_mutually_exclusive_group(required=True)
    operation.add_argument('--legacy-presign-function')
    operation.add_argument('--restore', type=Path, help='Restore the settings saved by an earlier cutover.')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--backup-dir', type=Path, default=Path.home() / '.mab-private' / 'account-cutover')
    args = parser.parse_args()
    restoration = None
    if args.restore:
        restoration = json.loads(args.restore.read_text())
        if set(restoration.get('buckets', {})) != {'midauthorbio-gtotree-input', 'midauthorbio-gtotree-results'} or restoration.get('legacy_auth_type') not in {'NONE', 'AWS_IAM'}:
            parser.error('Invalid saved settings.')
        fields = {'BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'}
        for config in restoration['buckets'].values():
            if config is not None and (set(config) != fields or any(type(value) is not bool for value in config.values())):
                parser.error('Invalid saved bucket settings.')
        args.legacy_presign_function = restoration['legacy_function']
    session = boto3.Session(region_name='us-east-2')
    s3, lam = session.client('s3'), session.client('lambda')
    config = lam.get_function_configuration(FunctionName=args.legacy_presign_function)
    variables = config.get('Environment', {}).get('Variables', {})
    if variables.get('INPUT_BUCKET') != 'midauthorbio-gtotree-input' or variables.get('PROFILES_TABLE'):
        parser.error('Select the old GToTree presign Lambda, not the accounts API or another app.')
    functions = lam.get_function_url_config(FunctionName=args.legacy_presign_function)
    if restoration:
        print('Restore the original bucket access and legacy upload configuration from:', args.restore)
        if not args.apply:
            print('Read-only. Add --apply to restore these settings.')
            return
        for bucket, config in restoration['buckets'].items():
            if config is None:
                s3.delete_public_access_block(Bucket=bucket)
            else:
                s3.put_public_access_block(Bucket=bucket, PublicAccessBlockConfiguration=config)
        lam.update_function_url_config(FunctionName=args.legacy_presign_function, AuthType=restoration['legacy_auth_type'])
        print('Original access settings restored.')
        return
    buckets = ['midauthorbio-gtotree-input', 'midauthorbio-gtotree-results']
    previous = {}
    for bucket in buckets:
        try:
            previous[bucket] = s3.get_public_access_block(Bucket=bucket)['PublicAccessBlockConfiguration']
        except s3.exceptions.ClientError as error:
            if error.response['Error']['Code'] != 'NoSuchPublicAccessBlockConfiguration':
                raise
            previous[bucket] = None
    print('Make GToTree input/results buckets private and require IAM on old upload URL:')
    print(functions['FunctionUrl'])
    if not args.apply:
        print('Read-only. Add --apply after authenticated access has been tested.')
        return
    os.umask(0o077)
    backup = args.backup_dir / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(parents=True, mode=0o700)
    saved = {'buckets': previous, 'legacy_function': args.legacy_presign_function,
             'legacy_auth_type': functions['AuthType']}
    (backup / 'settings.json').write_text(json.dumps(saved, indent=2))
    try:
        # Close anonymous upload first, then direct reads. Worker IAM access remains.
        lam.update_function_url_config(FunctionName=args.legacy_presign_function, AuthType='AWS_IAM')
        for bucket in buckets:
            s3.put_public_access_block(Bucket=bucket, PublicAccessBlockConfiguration={
                'BlockPublicAcls': True, 'IgnorePublicAcls': True,
                'BlockPublicPolicy': True, 'RestrictPublicBuckets': True})
    except Exception:
        # Restore settings if cutover does not finish. No result objects are edited.
        for bucket, config in previous.items():
            if config is None:
                s3.delete_public_access_block(Bucket=bucket)
            else:
                s3.put_public_access_block(Bucket=bucket, PublicAccessBlockConfiguration=config)
        lam.update_function_url_config(FunctionName=args.legacy_presign_function, AuthType=functions['AuthType'])
        raise
    print('Private cutover complete. Original settings:', backup / 'settings.json')


if __name__ == '__main__':
    main()

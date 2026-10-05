"""Fetch the pinned public snapshot outside the website (curl required)."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--cache', type=Path, required=True)
args = parser.parse_args()
meta = json.loads((Path(__file__).resolve().parents[1]/'data/model.json').read_text())
args.cache.mkdir(parents=True, exist_ok=True)
revision = meta['sourceRevision']
base = 'https://huggingface.co/datasets/steamgamerecommender/data_files_public'
for name in [*meta['sourceFiles'], 'README.md']:
    target = args.cache/name
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['curl', '-L', '--fail', '--retry', '3', f'{base}/resolve/{revision}/{name}',
                    '-o', str(target)], check=True)
    if name in meta['sourceFiles']:
        digest = hashlib.sha256()
        with open(target, 'rb') as f:
            while block := f.read(8*1024*1024): digest.update(block)
        if digest.hexdigest() != meta['sourceFiles'][name]:
            raise ValueError(f'Source checksum mismatch: {name}')
(args.cache/'dataset-info.json').write_text(json.dumps({'sha':revision}))

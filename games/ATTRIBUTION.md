# Data and license

Game Night uses the [Steam Game Ownership and User Friendships dataset](https://huggingface.co/datasets/steamgamerecommender/data_files_public),
created by Jackson Rusch, Akash Munagala, Jeffrey Pan, and Arjun Batra for a
Vanderbilt machine-learning project. The publisher collected public Steam
profiles using Steam's API and anonymized user identifiers.

The upstream dataset card declares GNU GPL v3.0. Its card is preserved in
[DATASET-README.md](DATASET-README.md) and the license text in
[DATASET-LICENSE.txt](DATASET-LICENSE.txt). The derived model and new files in
this directory are distributed under GPL v3.0. Source and reproducible training
instructions are provided in this repository. Original game names and other
Steam metadata remain attributable to their respective owners.

Pinned upstream revision: `d31fadbdcea69f26d3a3a6515607be1a23293303`, published
April 4, 2024. Exact collection dates are not documented. Source file SHA-256
digests are recorded in `data/model.json`. Only catalogs and item factors are
published here, not user histories or the unused friendship network.

This is an independent experiment, not affiliated with or endorsed by Valve,
Steam, Vanderbilt, or the dataset authors.

# Tanner Ratings website

Standalone HTML/CSS/JavaScript at `/tanner-ratings/`, linked from the shared site navigation. The site uses plain static HTML and `.nojekyll`. No build step is needed.

The sibling `PublicCode/football/ratings.py` command generates the data files and `data/index.json`. See that repo's football README for the weekly workflow. Each publication week uses games through the preceding week. The inaugural snapshot is 2026 Week 4. Future snapshots automatically enable rank movement and team history, limited to the selected season and week.

The site defaults to FBS, supports division and conference filters, search, rating/schedule sorting, downloadable CSVs, team game logs and rank history, next-week predicted lines, and a custom matchup calculator. Lines use rating differences rounded to the nearest half-point, with no home advantage. Missing ratings produce no line.

Preview from the website repo:

```powershell
python -m http.server 8000
```

Visit `http://localhost:8000/tanner-ratings/`. The personal pages and shared navigation are static HTML too. Deploy through the existing GitHub Pages process. Google Fonts are optional; system font fallbacks work offline.

# Tanner Phillips

Plain HTML, CSS, and JavaScript hosted on GitHub Pages. No Jekyll, package manager, or build step. `.nojekyll` tells GitHub Pages to publish the files directly from `master`.

- `index.html`: short professional profile.
- `cv/index.html`: experience and education; preserves the former CV URL.
- `assets/site.css`: shared colors, fonts, navigation, and personal-page styling.
- `tanner-ratings/`: interactive college football ratings, with its own application styles and JavaScript. The sibling PublicCode repo generates its weekly data.
- `404.html`, `sitemap.xml`, `robots.txt`: static discovery and error pages.
- `about/`, `about.html`, `portfolio/`, `publications/`, `teaching/`, `talks/`, and `wordpress/cv/`: redirects for previous landing-page URLs.

Preview from this directory with `python -m http.server 8000`, then open http://localhost:8000/. Edit the HTML directly. Navigation markup is repeated in the main pages; keep it consistent when adding a page. Google Fonts are optional and have system fallbacks. The personal pages and navigation work without JavaScript.

The academic theme, notebooks, old documents, and retired research pages were removed from the publishing tree; they remain in Git history. Do not restore them to the root merely to archive them: without Jekyll exclusions, static files are public. The original theme license is retained in `LICENSE`.

After editing the ratings JavaScript, CSS, or graphics, run `python share_cards.py` from the sibling `PublicCode/football` directory before publishing. It updates content-versioned asset URLs in the ratings HTML to prevent stale scripts/styles from being mixed with a new page. The generated site remains fully static.

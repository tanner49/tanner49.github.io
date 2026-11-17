"""Render the podcast page from official feeds; retain the published page on failure."""
from datetime import timezone
from email.utils import parsedate_to_datetime
from html import escape, unescape
from html.parser import HTMLParser
from pathlib import Path
import re
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
FEED = 'https://api.substack.com/feed/podcast/11018089.rss'
NS = {'itunes': 'http://www.itunes.com/dtds/podcast-1.0.dtd'}

class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts = []
    def handle_data(self, data):
        self.parts.append(data)

def plain(value):
    parser = PlainText(); parser.feed(value or '')
    return ' '.join(' '.join(parser.parts).split())

def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'WhiteBoxPodcastSite/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return ET.fromstring(response.read()).find('channel')

def url(value):
    if not value or not value.startswith('https://'):
        raise ValueError('Expected an HTTPS feed link')
    return escape(value, quote=True)

def render():
    channel = fetch(FEED)
    try:
        summaries = {i.findtext('link'): plain(i.findtext('description'))
                     for i in fetch('https://thewhiteboxpodcast.substack.com/feed').findall('item')}
    except Exception:
        summaries = {}
    items = [i for i in channel.findall('item') if i.find('enclosure') is not None
             and i.find('enclosure').get('type', '').startswith('audio/')]
    if not items:
        raise ValueError('No audio episodes found; refusing to replace the page')
    items.sort(key=lambda i: parsedate_to_datetime(i.findtext('pubDate')), reverse=True)
    cards = []
    for n, item in enumerate(items):
        title = escape(item.findtext('title'))
        link = item.findtext('link')
        published = parsedate_to_datetime(item.findtext('pubDate')).astimezone(timezone.utc)
        raw_duration = item.findtext('itunes:duration', '', NS)
        parts = raw_duration.split(':')
        seconds = sum(int(v) * 60 ** i for i, v in enumerate(reversed(parts))) if all(v.isdigit() for v in parts) else 0
        duration = f'{seconds // 3600} hr {seconds % 3600 // 60} min' if seconds >= 3600 else f'{seconds // 60} min'
        description = summaries.get(link) or plain(item.findtext('description'))
        description = re.sub(r'^Listen now \([^)]*\)\s*\|\s*', '', description)
        enclosure = url(item.find('enclosure').get('url'))
        transcript = item.find('{https://podcastindex.org/namespace/1.0}transcript')
        transcript_link = f'<a href="{url(transcript.get("url"))}">Transcript ↗</a>' if transcript is not None else ''
        cards.append(f'''<article class="episode" aria-labelledby="episode-{n}">
          <div class="episode-meta"><span>{'LATEST EPISODE' if n == 0 else 'EPISODE'}</span><time datetime="{published.date()}">{published.strftime('%b %d, %Y')}</time>{f'<span>{duration}</span>' if seconds else ''}</div>
          <h3 id="episode-{n}">{title}</h3><p class="episode-description">{escape(description)}</p>
          <audio controls preload="none" aria-label="Listen to {title}"><source src="{enclosure}" type="audio/mpeg">Your browser does not support audio. <a href="{enclosure}">Listen to the episode</a>.</audio>
          <div class="episode-links"><a href="{url(link)}">Episode &amp; show notes ↗</a>{transcript_link}</div>
        </article>''')
    template = (ROOT / '.github/templates/podcast.html').read_text(encoding='utf-8')
    rendered = template.replace('{{EPISODES}}', '\n'.join(cards)).replace('{{ARTWORK}}', url(channel.find('itunes:image', NS).get('href')))
    rendered = rendered.replace('{{DESCRIPTION}}', escape(plain(channel.findtext('itunes:subtitle', '', NS))))
    destination = ROOT / 'podcast/index.html'
    destination.write_text(rendered, encoding='utf-8')
    print(f'Rendered {len(items)} podcast episode(s).')

if __name__ == '__main__':
    render()

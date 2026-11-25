"""Regression coverage for feed outages that previously failed scheduled deploys."""
import io
import tempfile
import unittest
import urllib.error
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

import sync_podcast as sync


RSS = b'''<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
<itunes:image href="https://example.com/art.jpg"/><itunes:subtitle>Our podcast</itunes:subtitle>
<item><title>Test &amp; episode</title><link>https://example.com/episode</link>
<pubDate>Wed, 25 Nov 2026 12:00:00 GMT</pubDate><description>Episode summary</description>
<enclosure type="audio/mpeg" url="https://example.com/audio.mp3"/></item>
</channel></rss>'''


def forbidden():
    return urllib.error.HTTPError(sync.FEED, 403, 'Forbidden', {}, None)


class FeedTests(unittest.TestCase):
    @patch.object(sync.time, 'sleep')
    def test_transient_error_retries(self, sleep):
        with patch.object(sync.urllib.request, 'urlopen', side_effect=[forbidden(), io.BytesIO(RSS)]) as fetch:
            channel = sync.fetch(sync.FEED)
        self.assertEqual(len(sync.audio_items(channel)), 1)
        self.assertEqual(fetch.call_count, 2)
        sleep.assert_called_once_with(1)

    @patch.object(sync.time, 'sleep')
    def test_blocked_api_uses_publication_feed(self, sleep):
        with patch.object(sync.urllib.request, 'urlopen', side_effect=[
                forbidden(), forbidden(), forbidden(), io.BytesIO(RSS)]) as fetch:
            channel, source = sync.podcast_channel()
        self.assertEqual(source, sync.PUBLICATION_FEED)
        self.assertEqual(len(sync.audio_items(channel)), 1)
        self.assertEqual(fetch.call_args.args[0].full_url, sync.PUBLICATION_FEED)

    def test_empty_primary_uses_audio_fallback(self):
        with patch.object(sync, 'fetch', side_effect=[ET.fromstring('<channel/>'), ET.fromstring(RSS).find('channel')]):
            channel, source = sync.podcast_channel()
        self.assertEqual(source, sync.PUBLICATION_FEED)

    def test_outage_keeps_existing_page(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            destination = root / 'podcast/index.html'
            destination.parent.mkdir()
            destination.write_text('Existing page', encoding='utf-8')
            with patch.object(sync, 'ROOT', root), patch.object(sync, 'fetch', side_effect=forbidden()):
                with self.assertRaisesRegex(RuntimeError, 'All official podcast feeds failed'):
                    sync.render()
            self.assertEqual(destination.read_text(encoding='utf-8'), 'Existing page')

    def test_fallback_renders_audio_and_escapes_title(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            template = root / '.github/templates/podcast.html'
            template.parent.mkdir(parents=True)
            template.write_text('{{EPISODES}} {{ARTWORK}} {{DESCRIPTION}}', encoding='utf-8')
            (root / 'podcast').mkdir()
            channel = ET.fromstring(RSS).find('channel')
            with patch.object(sync, 'ROOT', root), patch.object(sync, 'podcast_channel', return_value=(channel, sync.PUBLICATION_FEED)):
                sync.render()
            html = (root / 'podcast/index.html').read_text(encoding='utf-8')
            self.assertIn('Test &amp; episode', html)
            self.assertIn('https://example.com/audio.mp3', html)
            self.assertNotIn('{{EPISODES}}', html)
            self.assertFalse((root / 'podcast/index.html.tmp').exists())


if __name__ == '__main__':
    unittest.main()

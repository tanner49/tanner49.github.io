import unittest
from train import clean_title,key

class Titles(unittest.TestCase):
    def test_seasons_and_editions(self):
        for value in ['Friends: Season 8','Friends: The Complete Fifth and Final Season [DVD]',
                      'Friends - The Complete First & Second Seasons','Friends (Season 2)',
                      'Friends: The Complete Series [Blu-ray]']:
            title,evidence=clean_title(value)
            self.assertEqual(key(title),'friends',value)
            self.assertTrue(evidence)

    def test_identity_and_subtitles(self):
        self.assertEqual(key(clean_title('Breaking Bad - The Final Season')[0]),'breakingbad')
        self.assertEqual(key(clean_title('The Big Bang Theory: The Complete Eleventh Season')[0]),'bigbangtheory')
        self.assertEqual(key(clean_title('Star Trek: The Next Generation - Season 3')[0]),'startrekthenextgeneration')
        self.assertNotEqual(key(clean_title('The Office (UK): Season 1')[0]),key(clean_title('The Office (US): Season 1')[0]))
        self.assertEqual(key(clean_title('Batman: The Complete Animated Series')[0]),'batmantheanimatedseries')

if __name__=='__main__':unittest.main()

"""Regression tests for observed-only SGD semantics (no dataset needed)."""
import unittest
import numpy as np
from recommender_training.mf import epoch


class ObservedOnlyTests(unittest.TestCase):
    def test_exact_gradient_uses_old_factors(self):
        p = np.array([[.2]], dtype='float32')
        q = np.array([[.4]], dtype='float32')
        bu = np.zeros(1, 'float32')
        bi = np.zeros(1, 'float32')
        epoch(np.array([0]), np.array([0]), np.array([1.]), np.array([False]),
              np.array([0]), np.array([0]), p, q, bu, bi, 3., .01, .02)
        error = 1 - (3 + .2*.4)
        self.assertAlmostEqual(float(p[0, 0]), .2+.01*(error*.4-.02*.2), places=6)
        self.assertAlmostEqual(float(q[0, 0]), .4+.01*(error*.2-.02*.4), places=6)
        self.assertAlmostEqual(float(bu[0]), .01*error, places=6)
        self.assertAlmostEqual(float(bi[0]), .01*error, places=6)

    def test_missing_and_held_out_pairs_make_no_updates(self):
        p = np.array([[.2], [.3]], dtype='float32')
        q = np.array([[.4], [.5], [.6]], dtype='float32')
        bu = np.zeros(2, 'float32')
        bi = np.zeros(3, 'float32')
        # Only (user 0, item 0) is observed training feedback. (1, 1) is held
        # out and item 2 has no observations at all. None are zero ratings.
        epoch(np.array([0, 1]), np.array([0, 1]), np.array([1., 5.]), np.array([False, True]),
              np.array([0]), np.array([0]), p, q, bu, bi, 3., .01, .02)
        np.testing.assert_array_equal(p[1], np.array([.3], 'float32'))
        np.testing.assert_array_equal(q[1:], np.array([[.5], [.6]], 'float32'))
        self.assertEqual(bu[1], 0)
        np.testing.assert_array_equal(bi[1:], [0, 0])
        self.assertLess(bi[0], 0, 'An actual low rating must give negative feedback')

    def test_block_permutation_visits_full_and_partial_blocks_once(self):
        count = 4101
        # Unique user/item per observation makes omissions/duplicates visible.
        p = np.zeros((count, 1), 'float32')
        q = p.copy()
        bu = np.zeros(count, 'float32')
        bi = bu.copy()
        epoch(np.arange(count), np.arange(count), np.full(count, 5.), np.zeros(count, bool),
              np.array([1, 0]), np.array([4000, 3]), p, q, bu, bi, 3., .01, .02)
        np.testing.assert_allclose(bu, .02)
        np.testing.assert_allclose(bi, .02)


if __name__ == '__main__': unittest.main()

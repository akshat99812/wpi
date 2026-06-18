"""Foundation parity: JS-exact rounding + shared reductions (numeric.py).

The asserted values are what V8/JSC produce — chosen to DIVERGE from Python's
banker's ``round`` so a regression to the built-in is caught immediately.
"""
import math

import pytest

from app.engine.numeric import (
    all_finite,
    clamp,
    clamp01,
    js_round,
    mean_of,
    percentile_of_sorted,
    round1,
    round_to,
    to_finite_number,
)


class TestJsRound:
    @pytest.mark.parametrize(
        "x,expected",
        [
            (0.5, 1), (1.5, 2), (2.5, 3),      # half toward +inf
            (-0.5, 0), (-1.5, -1), (-2.5, -2),  # NOT toward -inf, NOT to-even
            (0.49999999999999994, 0),           # classic double edge case
            (0.4, 0), (0.6, 1),
        ],
    )
    def test_matches_js_math_round(self, x, expected):
        assert js_round(x) == expected


class TestRoundTo:
    def test_half_up_differs_from_bankers(self):
        # Python's round(0.125, 2) == 0.12 (to-even); JS Math.round gives 0.13.
        assert round_to(0.125, 2) == 0.13

    def test_multiply_then_round_semantics(self):
        # roundTo multiplies FIRST: 2.675*100 rounds to the double 267.5, then
        # Math.round(267.5) = 268 (half up) -> 2.68. (This differs from
        # 2.675.toFixed(2) == "2.67", which is a separate JS algorithm.) The
        # legacy roundTo gives 2.68 here, so the port must too.
        assert round_to(2.675, 2) == 2.68

    def test_negative_half(self):
        assert round_to(-2.5, 0) == -2

    def test_one_decimal_helper(self):
        assert round1(2.45) == round_to(2.45, 1)

    def test_non_finite_passes_through(self):
        assert math.isnan(round_to(math.nan, 2))
        assert round_to(math.inf, 2) == math.inf
        assert round_to(-math.inf, 0) == -math.inf

    def test_integer_valued_result_is_numeric(self):
        assert round_to(8.0001, 0) == 8.0


class TestMeanOf:
    def test_empty_is_nan(self):
        assert math.isnan(mean_of([]))

    def test_simple_mean(self):
        assert mean_of([1.0, 2.0, 3.0]) == 2.0

    def test_sequential_float64(self):
        # Sequential accumulation, not pairwise — match the TS for loop.
        assert mean_of([0.1, 0.2, 0.3]) == (0.1 + 0.2 + 0.3) / 3


class TestPercentileOfSorted:
    def test_median_interpolates(self):
        assert percentile_of_sorted([1.0, 2.0, 3.0, 4.0], 0.5) == 2.5

    def test_r7_lower_quartile(self):
        assert percentile_of_sorted([10.0, 20.0, 30.0, 40.0], 0.25) == 17.5

    def test_endpoints(self):
        data = [5.0, 6.0, 9.0]
        assert percentile_of_sorted(data, 0.0) == 5.0
        assert percentile_of_sorted(data, 1.0) == 9.0

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            percentile_of_sorted([], 0.5)

    @pytest.mark.parametrize("q", [-0.01, 1.01, math.nan])
    def test_out_of_range_raises(self, q):
        with pytest.raises(ValueError):
            percentile_of_sorted([1.0, 2.0], q)


class TestClamps:
    @pytest.mark.parametrize("x,expected", [(-1, 0), (0, 0), (0.5, 0.5), (1, 1), (2, 1)])
    def test_clamp01(self, x, expected):
        assert clamp01(x) == expected

    def test_clamp_band(self):
        assert clamp(0.8, 0.0, 0.6) == 0.6
        assert clamp(-0.1, 0.0, 0.6) == 0.0
        assert clamp(0.3, 0.0, 0.6) == 0.3


class TestToFiniteNumber:
    def test_coerces_strings_like_Number(self):
        assert to_finite_number("12.5") == 12.5
        assert to_finite_number(7) == 7.0

    @pytest.mark.parametrize("bad", [math.inf, -math.inf, math.nan])
    def test_rejects_non_finite(self, bad):
        with pytest.raises(ValueError):
            to_finite_number(bad)

    def test_all_finite(self):
        assert all_finite([1.0, 2.0, 3.0])
        assert not all_finite([1.0, math.nan])

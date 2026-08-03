# Ranking, confidence and missing data

## Grade U (unrated)

Grade **U** is used when the system cannot present a reliable letter grade. Current mechanisms include:

- dimension / overall confidence below `minConfidenceForGrade` (default **0.35**) → grade `U` (`packages/scoring` `presentGrade`);
- model coverage below 50% of available weight → `overallState = PROVISIONAL` and grade forced to `U`.

## Low-confidence but ranked / viewable profiles

If calculation is possible but confidence is weak:

- publish the numeric Trust Score and letter grade when grade rules allow;
- visibly flag uncertainty (warnings, UI “Low confidence” banners — display threshold may differ from grade floor).

Missing dimensions must **not** become a hidden bonus via unrestricted weight redistribution. Changing missing-data mathematics requires explicit approval and a new model version.

## Ranking eligibility vs grade U

Ranking ineligibility (for example Utility not publishable under v6 eligibility rules) is **not** the same as grade U:

- numeric Trust Score / grade may still be shown;
- `rankingEligibility.eligible = false` excludes the profile from complete ranking;
- the profile may still be marked provisional for ranking purposes.

## Warnings

`INSUFFICIENT_DATA` style warnings may fire when grade is `U` or confidence is below the grade floor. Treat UI copy that still claims “shrunk toward neutral” as legacy unless the active model formula still blends confidence into overall (v6 does **not**).

## Programme policy summary

From [`product-scope.md`](product-scope.md):

- impossible calculation → `U`;
- weak confidence with calculable score → publish + flag uncertainty;
- boost remains a separate suspicion signal.

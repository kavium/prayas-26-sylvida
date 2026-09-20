# Final neural need-score formula

## Sectors

The score uses five service sectors:

\[
K=\{\text{Civic, Commercial, Green, Office, Utility}\}.
\]

## 1. Observed provision

For cell \(s\), sector \(k\), and cells \(j\) within 1 km:

\[
a_{s,j}=\exp\left(-\frac{d_{s,j}}{1.5}\right)
\]

\[
q_{s,k}=
\frac{
\sum_{j:d_{s,j}\leq1\text{ km}}
a_{s,j}\mathbf 1(\operatorname{type}_j=k)
}{
\sum_{j:d_{s,j}\leq1\text{ km}}a_{s,j}
}.
\]

How to obtain it: read `type`, `x`, and `y` from each real city-grid CSV. Compute Euclidean grid distance in kilometres. The focal cell is included because its distance is zero. `sector_neural_need_scores.csv` stores this as `observed_provision`.

## 2. Per-model neural outputs

Three independently initialized graph-attention models are used:

\[
m\in\{11,26,41\}.
\]

Each model receives:

- focal-cell population density;
- cells in the outer ring \(1<d_{s,j}\leq3\) km;
- each neighbor's categorical type and population density;
- relative \(x\), \(y\), and distance;
- distance-weighted outer-ring sector shares.

Each model directly outputs:

\[
\mu^{(m)}_{s,k}=\text{expected provision},
\]

\[
\sigma^{(m)}_{s,k}
=0.03+0.45\operatorname{sigmoid}(z^{(m)}_{s,k}).
\]

Therefore:

\[
0.03\leq\sigma^{(m)}_{s,k}\leq0.48.
\]

How to obtain them: load each `neural_reference_seed_<seed>.keras` file and call `model.predict(...)`. The first ten returned columns are \(\mu^{(m)}\) for all land-use sectors. The final five columns are \(\sigma^{(m)}\) for the five service sectors.

The uncertainty head is trained with:

\[
\mathcal L=
5\operatorname{mean}_{k\in\text{all sectors}}
(q_{s,k}-\mu_{s,k})^2
+
\operatorname{mean}_{k\in K}
\left[
\log\sigma_{s,k}
+\frac{(q_{s,k}-\mu_{s,k})^2}{2\sigma_{s,k}^2}
\right].
\]

## 3. Ensemble expected provision

With \(M=3\):

\[
\bar\mu_{s,k}
=\frac1M\sum_{m=1}^{M}\mu^{(m)}_{s,k}.
\]

How to obtain it: average the same sector column from the three model predictions. `neural_expected_provision.csv` stores \(\bar\mu\).

## 4. Ensemble neural uncertainty

\[
\bar\sigma_{s,k}
=
\sqrt{
\frac1M\sum_{m=1}^{M}
\left[
(\sigma^{(m)}_{s,k})^2
+(\mu^{(m)}_{s,k})^2
\right]
-\bar\mu_{s,k}^2
}.
\]

This includes each model's predicted uncertainty and disagreement between models.

How to obtain it: apply the equation to the three model outputs. `sector_neural_need_scores.csv` stores it as `neural_uncertainty`.

## 5. Relative sector shortage

Use:

\[
\epsilon=0.0001.
\]

\[
d_{s,k}
=
\operatorname{clip}
\left(
\frac{\bar\mu_{s,k}-q_{s,k}}
{\max(\bar\mu_{s,k},\epsilon)},
0,1
\right).
\]

How to obtain it: substitute observed provision and ensemble expected provision. `sector_neural_need_scores.csv` stores it as `relative_shortage`.

Interpretation:

- \(d_{s,k}=0\): observed provision meets or exceeds neural expectation.
- \(d_{s,k}=1\): maximum relative shortage.

## 6. Confidence-aware sector weights

Current policy coefficients:

\[
\pi_{\text{Civic}}
=\pi_{\text{Commercial}}
=\pi_{\text{Green}}
=\pi_{\text{Office}}
=\pi_{\text{Utility}}
=1.
\]

Uncertainty floor:

\[
\sigma_0=0.05.
\]

\[
w_{s,k}
=
\frac{
\pi_k/(\bar\sigma_{s,k}+\sigma_0)
}{
\sum_{r\in K}\pi_r/(\bar\sigma_{s,r}+\sigma_0)
}.
\]

How to obtain it: substitute \(\bar\sigma\), \(\pi_k\), and \(\sigma_0\). `sector_neural_need_scores.csv` stores it as `cell_sector_weight`. The five weights for each cell sum to one.

## 7. Final need score

\[
\boxed{
N_s=100\sum_{k\in K}w_{s,k}d_{s,k}
}
\]

Range:

\[
0\leq N_s\leq100.
\]

How to obtain it: multiply every sector's `relative_shortage` by `cell_sector_weight`, sum the five products, then multiply by 100. `cell_neural_need_scores.csv` stores it as `N_s`.

## 8. Planning priority

\[
P_s=p_sN_s.
\]

Current default:

\[
p_s=1.
\]

How to obtain \(p_s\): provide an external planning-priority multiplier from policy, hazard, vulnerability, or project requirements. When unavailable, use 1. `cell_neural_need_scores.csv` stores the result as `planning_priority`.

## Fixed constants

| Value | Current setting |
| --- | ---: |
| Inner observation radius | 1 km |
| Neural outer-neighborhood radius | 3 km |
| Distance decay | 1.5 km |
| Ensemble models | 3 |
| Seeds | 11, 26, 41 |
| \(\epsilon\) | 0.0001 |
| \(\sigma_0\) | 0.05 |
| Every \(\pi_k\) | 1.0 |
| Default \(p_s\) | 1.0 |

## Model coefficients

The attention and dense-layer coefficients are learned tensors rather than five printable scalar coefficients. They are stored inside the three `.keras` model files.

Retrieve them with:

```python
import tensorflow as tf

model = tf.keras.models.load_model(
    "neural_reference_seed_26.keras",
    compile=False,
)
coefficients = model.get_weights()
```

Normal use does not require reading these tensors. Call `model.predict(...)` to obtain \(\mu^{(m)}\) and \(\sigma^{(m)}\), then apply the equations above.

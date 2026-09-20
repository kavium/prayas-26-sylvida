# Final neural livability-score formula

## Symbols

| Symbol | Meaning |
| --- | --- |
| \(s\) | focal 1 km grid cell being scored |
| \(j\) | neighboring cell, used only when \(d_{sj}\le5\) |
| \(P_s\) | population in cell \(s\) |
| \(G_s\) | local `green_cover_pct` |
| \(T_s\) | categorical land-use class |
| \(x_s\) | encoded focal-cell features |
| \(H_s\) | masked five-cell spatial context |
| \(m\) | one network seed: 11, 26, or 41 |
| \(h\) | one of three learned attention heads |
| \(W,b,\theta\) | learned neural matrices, biases, and parameters |
| \(\sigma(z)\) | logistic sigmoid, \(1/(1+e^{-z})\) |
| \(p_s^{(m)}\) | one network's output probability |
| \(L_s\) | final livability score, from 0 to 1 |
| \(I_s\) | population-weighted impact of a scenario change |

## Output

For cell \(s\), livability is:

\[
\boxed{
L_s=\frac{1}{3}\sum_{m\in\{11,26,41\}}
\sigma\!\left(g_{\theta_m}(x_s,H_s)\right)
}
\]

\[
0\le L_s\le1.
\]

All coefficients inside \(g_{\theta_m}\) are learned. There are no hand-written weights for green space, density, land use, or spatial context.

Meaning: each network turns one cell plus its surroundings into a probability. Averaging three separately trained networks gives stable \(L_s\). High \(L_s\) means strong resemblance to coherent model-city patterns. Low \(L_s\) means weak resemblance.

## Inputs

\[
x_s=
\left[
\operatorname{standardize}(\log(1+P_s)),
\operatorname{standardize}(G_s),
\operatorname{onehot}(T_s)
\right],
\]

where \(P_s\) is population, \(G_s\) is `green_cover_pct`, and \(T_s\) is categorical land use.

Five-cell context:

\[
H_s=
\left\{
\left[x_j,\frac{\Delta x_{sj}}5,\frac{\Delta y_{sj}}5,\frac{d_{sj}}5\right]
:d_{sj}\le5
\right\}.
\]

Missing grid positions are masked. Numeric scaling is fitted on model cities only.

Meaning: \(x_s\) describes cell \(s\). \(H_s\) describes its surroundings. `standardize` uses fixed mean and standard deviation from ten model cities; it never recalculates statistics from Mumbai, Bengaluru, or a target scenario. \(\Delta x\), \(\Delta y\), and \(d\) encode each neighbor's relative location.

Excluded: facility/service access, population/service ratios, city-level quality scores, Mumbai/Bengaluru-only building density, and uncertainty penalties.

## Learned spatial attention

For network \(m\), attention head \(h\):

\[
a_{sj}^{(m,h)}=
\operatorname{softmax}_{j:d_{sj}\le5}
\left(
\frac{(W_Q^{(m,h)}x_s)^T(W_K^{(m,h)}H_{sj})}{\sqrt{16}}
\right),
\]

\[
c_s^{(m,h)}=
\sum_{j:d_{sj}\le5}a_{sj}^{(m,h)}W_V^{(m,h)}H_{sj}.
\]

Three attention heads form \(c_s^{(m)}\). Network learns nonlinear interactions from:

\[
u_s^{(m)}=
\left[
W_F^{(m)}x_s,
c_s^{(m)},
\left|W_F^{(m)}x_s-c_s^{(m)}\right|,
(W_F^{(m)}x_s)\odot c_s^{(m)}
\right].
\]

Then:

\[
p_s^{(m)}=\sigma\left(\operatorname{MLP}_{\theta_m}(u_s^{(m)})\right).
\]

Final boxed formula averages three independent networks. Averaging improves stability; it adds no uncertainty penalty.

Meaning: \(a_{sj}^{(m,h)}\) is learned attention from cell \(s\) to neighbor \(j\); valid-neighbor attentions sum to one. \(c_s^{(m,h)}\) is one head's learned neighborhood summary. \(u_s^{(m)}\) combines focal pattern, neighborhood pattern, their difference, and their interaction. \(p_s^{(m)}\) is one network's final reference-pattern probability.

## Training

Positive examples are every real cell and five-cell neighborhood from:

1. Tokyo
2. Singapore
3. Copenhagen
4. Amsterdam
5. Barcelona
6. Zurich
7. Stockholm
8. London
9. Paris
10. New York City

Each negative starts as real model-city data and receives one symmetric corruption:

- focal cell paired with another real context;
- population shifted far below or above reference distribution;
- green cover shifted far below or above reference distribution;
- local land-use mixture collapsed to one randomly selected class.

No factor percentages are assigned. Binary cross-entropy learns every feature and interaction coefficient:

\[
\mathcal L(\theta_m)=
-\frac1n\sum_i
\left[y_i\log p_i^{(m)}+(1-y_i)\log(1-p_i^{(m)})\right].
\]

Meaning: \(L_s\) estimates probability that a cell and five-cell context resemble a coherent pattern learned from the ten model cities.

Loss meaning: \(y_i=1\) for a real model-city neighborhood; \(y_i=0\) for a corrupted version. Training makes real patterns score high and corrupted patterns score low. This learns feature importance and interactions inside \(\theta_m\), instead of assigning manual percentages.

## Density result

Density is not declared good or bad. Symmetric high/low corruption lets networks learn its shape.

| Standardized log-population shift | Mean \(L_s\) |
| ---: | ---: |
| -4σ | 0.000041 |
| -2σ | 0.1504 |
| -1σ | 0.7360 |
| 0σ | **0.8491** |
| +1σ | 0.7339 |
| +2σ | 0.1144 |
| +4σ | approximately 0 |

Networks learned a clear interior density sweet spot. Lowest density is not best.

## Target isolation

Mumbai and Bengaluru are strictly inference-only. They are excluded from scaling, training, early stopping, epoch selection, validation, testing, and calibration.

## Global comparability

Same scaler, networks, radius, and sigmoid mapping apply to every city. Scores are never re-ranked within a target city. Thus \(0.7\) uses the same learned reference everywhere.

| Target | Cells | Mean \(L_s\) | Median \(L_s\) |
| --- | ---: | ---: | ---: |
| Mumbai | 738 | 0.5858 | 0.6439 |
| Bengaluru | 1,008 | 0.7073 | 0.7581 |

## Held-out checks

Eight cities trained validation model. London selected epoch. Barcelona stayed untouched until test.

| Split | AUC | Log loss |
| --- | ---: | ---: |
| Eight-city training | 0.9382 | 0.2678 |
| London validation | 0.9056 | 0.3177 |
| Barcelona test | 0.8944 | 0.3924 |

Gap is modest; light check found no obvious overfitting.

## Population impact

For impact of change:

\[
\boxed{I_s=P_s\left(L_s^{\mathrm{after}}-L_s^{\mathrm{before}}\right)}
\]

Positive means population-weighted improvement. For absolute population-weighted livability level, use \(P_sL_s\).

Meaning: \(I_s\) measures people affected by a change, not current livability. A 0.10 score gain affects more people in a high-population cell. Use \(P_sL_s\) only for absolute population-weighted livability, never for a before/after change result.

## Files

- Notebook: `notebooks/prayas_neural_livability.ipynb`
- Executed notebook: `notebooks/prayas_neural_livability_executed.ipynb`
- Target scores: `notebooks/prayas_neural_livability_outputs/target_livability_scores.csv`
- All scores: `notebooks/prayas_neural_livability_outputs/cell_livability_scores.csv`
- Models: `notebooks/prayas_neural_livability_outputs/livability_attention_seed_*.keras`
- Validation: `notebooks/prayas_neural_livability_outputs/validation_metrics.csv`
- Density response: `notebooks/prayas_neural_livability_outputs/density_response.csv`

## Limit

Without resident surveys or observed neighborhood outcomes, \(L_s\) is a neural model-city resemblance proxy, not proven causal quality of life. It supports consistent before/after scenario comparison when input construction and trained models stay fixed.

/**
 * The stored optional decision layer (`docs/data-model.md` §2 `[decision_layer]`).
 *
 * Off by default, with no model. The layer's rules are always on; the local
 * model it could optionally rank search results with is not shipped, so a
 * stored `model` is only ever the empty string.
 */
export type DecisionSettings = {
  enabled: boolean;
  model: string;
};

/**
 * The view every `decision.*` reply carries.
 *
 * `rulesOnly` is the literal `true` and `localModel.supported` the literal
 * `false`: this build runs the rules and nothing else, so a shell cannot render
 * a state that claims a local model is available. `localModel.reason` says why,
 * in one sentence, and is never a promise or a silent fallback
 * (`docs/product.md` §10.4).
 */
export type DecisionView = DecisionSettings & {
  rulesOnly: true;
  localModel: { supported: false; reason: string };
};

/**
 * Why the optional local model is unavailable (`docs/product.md` §10.4).
 *
 * One sentence and always true: the app bundles no local model runtime, so
 * there is nothing to classify or rank with. It is not a setting the user can
 * close, which is why the view also carries `supported: false`.
 */
export const DECISION_LOCAL_MODEL_REASON =
  "No local model runtime is bundled in this build, so the decision layer runs rules only.";

/**
 * The one refusal when a non-empty `decision_layer.model` would be stored.
 *
 * This build cannot run a local model, so storing a model name would be a
 * promise the app never keeps. Rules-only is the only mode, and the model stays
 * empty rather than being accepted and silently ignored.
 */
export const DECISION_RULES_ONLY_REFUSAL =
  "This build has no local model runtime, so the decision layer is rules-only; leave the model empty.";

/**
 * The global Work write/command opt-in (`docs/product.md` §8.2).
 *
 * Both flags live in `config.toml` `[work]` and default to false. An approval
 * needs this flag **and** the resolved agent profile's own flag: the profile
 * cannot switch the global gate on, and the global gate cannot grant a
 * permission the profile does not have. The read is configuration, so a lower
 * layer (a tool call, a swarm worker, a plugin) cannot bypass it.
 */

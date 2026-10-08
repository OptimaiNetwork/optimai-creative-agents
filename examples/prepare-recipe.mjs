import { createAgentManifest, validateAgentManifest, compileAgentPrompt } from '../src/index.mjs';

// Preparing a recipe is useful without a model, account or external service.
const recipe = createAgentManifest('story-seed', {
  id: 'cloud-companion',
  title: 'Cloud Companion',
  brief: 'A curious explorer helps a lost cloud find its way home.'
});
const result = validateAgentManifest(recipe);
if (!result.success) throw new Error(result.errors.join('\n'));

console.log(compileAgentPrompt(result.manifest, { style: 'manga' }));

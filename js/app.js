// A small hub so screens can ask for a redraw or a new route without importing main.js.

export const app = {
  route: { tab: 'now', sub: '', id: '' },
  ui: { editing: false },
  render: () => {},
  renderView: () => {},
  go: (hash) => { if (location.hash !== hash) location.hash = hash; else app.render(); },
  acts: {},
  inputs: [],
  register(mod) {
    if (mod.acts) Object.assign(app.acts, mod.acts);
    if (mod.onInput) app.inputs.push(mod.onInput);
  }
};

import { readConfig } from './config.js';
import { respondToAgentRequest } from './agent.js';
import { validateAgentRequest } from './validation.js';

const sampleScene = {
  unit: 'mm',
  displayMode: 'surface',
  selection: ['fan-1'],
  meshes: [
    {
      id: 'fan-1',
      name: 'Turbofan fan',
      sourceFormat: 'procedural',
      visible: true,
      locked: false,
      selected: true,
      bounds: [-40, 40, -35, 35, -20, 20],
      stats: { points: 1200, cells: 800, triangles: 760 },
      transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
    },
  ],
};

const request = validateAgentRequest({
  id: 'smoke-1',
  text: '当前选中了什么？',
  mode: 'ask',
  scene: sampleScene,
  conversation: [],
});

const response = await respondToAgentRequest(request, readConfig());

console.log(JSON.stringify({ ok: true, kind: response.kind }, null, 2));

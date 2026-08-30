export function resolveE2EMode(arguments_, environment = process.env) {
  const explicitMode = environment.ARAVA_E2E_BACKGROUND?.trim();
  if (explicitMode && explicitMode !== '0' && explicitMode !== '1') {
    throw new Error('ARAVA_E2E_BACKGROUND must be 0 or 1.');
  }

  const requestedHeaded = arguments_.includes('--headed');
  const requestedDebug = arguments_.includes('--debug');
  const background = explicitMode ? explicitMode === '1' : !requestedHeaded && !requestedDebug;

  return {
    background,
    environment: {
      ...environment,
      ARAVA_E2E_BACKGROUND: background ? '1' : '0',
    },
    playwrightArguments: arguments_.filter((argument) => argument !== '--headed'),
  };
}

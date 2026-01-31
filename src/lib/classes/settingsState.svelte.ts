type Settings = {
  markedUnread: boolean,
  translationModel: 'nmt' | 'llm',
  disableEmbedVia: boolean,
};

const defaultSettings: Settings = {
  markedUnread: false,
  translationModel: 'nmt',
  disableEmbedVia: false,
}

// Debug logging prefix for easy filtering in console
const DEBUG_PREFIX = '[SETTINGS STATE]';

function debugLog(...args: any[]) {
    console.log(DEBUG_PREFIX, ...args);
}

class SettingsState {
  settings: Settings = $state(defaultSettings);
  pdsRequestReady: boolean = $state(false);

  constructor() {
    const storageSettings = localStorage.getItem('stateSettings') || JSON.stringify(defaultSettings);
    this.settings = JSON.parse(storageSettings);
    debugLog('LOAD from localStorage:', {
      markedUnread: this.settings.markedUnread,
      translationModel: this.settings.translationModel,
      disableEmbedVia: this.settings.disableEmbedVia,
    });

    $effect.root(() => {
      $effect(() => {
        debugLog('SAVE to localStorage:', {
          markedUnread: this.settings.markedUnread,
          translationModel: this.settings.translationModel,
          disableEmbedVia: this.settings.disableEmbedVia,
        });
        localStorage.setItem('stateSettings', JSON.stringify(this.settings));
      });
      return () => {};
    })
  }

  setPdsRequestReady() {
    this.pdsRequestReady = true;
  }
}

export const settingsState = new SettingsState();
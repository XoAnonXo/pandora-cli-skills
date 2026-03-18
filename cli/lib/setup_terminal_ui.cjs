'use strict';

const readline = require('readline');

function redactValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 12) {
    return `${text.slice(0, 2)}...`;
  }
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function createSetupTerminalUi({ stdin = process.stdin, stdout = process.stdout, isTTY = Boolean(stdin && stdin.isTTY && stdout && stdout.isTTY) } = {}) {
  const disableRawSelect = String(process.env.PANDORA_SETUP_DISABLE_RAW_SELECT || '').trim() === '1';

  function writeLine(value = '') {
    stdout.write(`${String(value)}\n`);
  }

  function writeLines(lines = []) {
    for (const line of lines) {
      writeLine(line);
    }
  }

  function createInterface() {
    return readline.createInterface({
      input: stdin,
      output: stdout,
      terminal: isTTY,
      historySize: 0,
      crlfDelay: Infinity,
    });
  }

  function questionFromInterface(prompt, { defaultValue = null, secret = false } = {}) {
    return new Promise((resolve) => {
      const rl = createInterface();
      const defaultText = defaultValue === null || defaultValue === undefined || String(defaultValue).trim() === ''
        ? ''
        : String(defaultValue);
      const promptLabel = defaultText
        ? `${prompt} [${secret ? redactValue(defaultText) : defaultText}]: `
        : `${prompt}: `;
      let stdoutMuted = Boolean(secret);
      const originalWriteToOutput = rl._writeToOutput.bind(rl);

      if (secret) {
        rl._writeToOutput = function mutedWriteToOutput(stringToWrite) {
          if (stdoutMuted) {
            return;
          }
          originalWriteToOutput(stringToWrite);
        };
      }

      rl.question(promptLabel, (answer) => {
        rl.close();
        const trimmed = String(answer || '').trim();
        if (trimmed) {
          resolve(trimmed);
          return;
        }
        resolve(defaultText);
      });

      rl.on('close', () => {
        stdoutMuted = false;
      });
    });
  }

  async function question(prompt, options = {}) {
    return questionFromInterface(prompt, options);
  }

  async function confirm(prompt, defaultValue = false) {
    const suffix = defaultValue ? '[y]' : '[n]';
    const answer = String(await question(`${prompt} ${suffix}`, { defaultValue: '' })).trim().toLowerCase();
    if (!answer) {
      return Boolean(defaultValue);
    }
    if (['y', 'yes', 'true', '1'].includes(answer)) {
      return true;
    }
    if (['n', 'no', 'false', '0'].includes(answer)) {
      return false;
    }
    return Boolean(defaultValue);
  }

  async function select(prompt, options = [], { initialIndex = 0 } = {}) {
    const normalized = Array.isArray(options) ? options.filter(Boolean) : [];
    if (!normalized.length) {
      throw new Error('createSetupTerminalUi.select requires at least one option.');
    }

    let index = Number.isInteger(initialIndex) ? initialIndex : 0;
    if (index < 0 || index >= normalized.length) {
      index = 0;
    }

    if (!isTTY || typeof stdin.setRawMode !== 'function' || disableRawSelect) {
      const answer = await questionFromInterface(
        `${prompt}\n${normalized.map((option, optionIndex) => `  ${optionIndex + 1}. ${option.label}${option.description ? ` - ${option.description}` : ''}`).join('\n')}\nSelect`,
        { defaultValue: String(index + 1) },
      );
      const parsed = Number.parseInt(String(answer || '').trim(), 10);
      const choiceIndex = Number.isInteger(parsed) && parsed >= 1 && parsed <= normalized.length
        ? parsed - 1
        : index;
      return normalized[choiceIndex];
    }

    return new Promise((resolve) => {
      let resolved = false;
      let renderCount = 0;
      let listening = false;

      const render = () => {
        if (renderCount > 0) {
          stdout.write(`\u001b[${renderCount}A`);
        }

        const lines = [prompt];
        normalized.forEach((option, optionIndex) => {
          const marker = optionIndex === index ? '❯' : ' ';
          const description = option.description ? `  ${option.description}` : '';
          lines.push(`${marker} ${optionIndex + 1}. ${option.label}${description}`);
        });
        lines.push(`Select [${index + 1}]: `);

        for (const line of lines) {
          stdout.write(`${line}\n`);
        }
        renderCount = lines.length;
      };

      const finish = (choiceIndex) => {
        if (resolved) return;
        resolved = true;
        if (listening) {
          stdin.off('keypress', onKeypress);
          listening = false;
        }
        try {
          stdin.setRawMode(false);
        } catch {
          // best-effort cleanup
        }
        stdin.pause();
        if (typeof stdin.read === 'function') {
          while (stdin.read() !== null) {
            // drain buffered keystrokes before the next prompt
          }
        }
        resolve(normalized[choiceIndex]);
      };

      const onKeypress = (str, key = {}) => {
        if (resolved) return;

        if (key && key.name === 'up') {
          index = (index - 1 + normalized.length) % normalized.length;
          render();
          return;
        }

        if (key && key.name === 'down') {
          index = (index + 1) % normalized.length;
          render();
          return;
        }

        if (key && (key.name === 'return' || key.name === 'enter')) {
          finish(index);
          return;
        }

        if (str === '\r' || str === '\n') {
          finish(index);
          return;
        }

        const text = String(str || '').trim();
        if (/^\d+$/.test(text)) {
          const candidate = Number.parseInt(text, 10) - 1;
          if (candidate >= 0 && candidate < normalized.length) {
            index = candidate;
          }
          return;
        }

        if (key && key.ctrl && key.name === 'c') {
          finish(index);
        }
      };

      try {
        stdin.setRawMode(true);
      } catch {
        // best-effort cleanup
      }
      stdin.setEncoding('utf8');
      readline.emitKeypressEvents(stdin);
      stdin.resume();
      stdin.on('keypress', onKeypress);
      listening = true;
      render();
    });
  }

  return {
    question,
    select,
    confirm,
    writeLine,
    writeLines,
    redactValue,
  };
}

module.exports = {
  createSetupTerminalUi,
  redactValue,
};

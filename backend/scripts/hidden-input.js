import { emitKeypressEvents } from 'node:readline';

export function readHidden(prompt, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY) return Promise.reject(new Error('INTERACTIVE_TERMINAL_REQUIRED'));
  output.write(prompt);
  emitKeypressEvents(input);
  const previousRaw = Boolean(input.isRaw);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      input.off('keypress', onKey);
      input.off('end', onEnd);
      input.off('error', onError);
      input.setRawMode(previousRaw);
      input.pause();
      output.write('\n');
    };
    const onEnd = () => { cleanup(); reject(new Error('INPUT_CLOSED')); };
    const onError = () => { cleanup(); reject(new Error('INPUT_FAILED')); };
    const onKey = (text, key = {}) => {
      if (key.ctrl && key.name === 'c') { cleanup(); reject(new Error('CANCELLED')); return; }
      if (key.name === 'return' || key.name === 'enter') { cleanup(); resolve(value); return; }
      if (key.name === 'backspace') { value = [...value].slice(0, -1).join(''); return; }
      if (text && !key.ctrl && !key.meta && !/[\u0000-\u001f\u007f]/.test(text) && value.length + text.length <= 512) value += text;
    };
    input.on('keypress', onKey);
    input.once('end', onEnd);
    input.once('error', onError);
  });
}

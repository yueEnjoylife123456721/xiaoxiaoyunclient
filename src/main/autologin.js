'use strict'

/**
 * 生成注入到原网页的「自动登录」脚本。
 *
 * 思路：不依赖固定选择器，用启发式规则在登录页里定位账号框/密码框，
 * 填值后模拟真实输入事件，再触发提交（优先按钮，其次表单，最后回车）。
 * 页面若是 SPA 或登录表单延迟渲染，脚本会在 timeoutMs 内轮询等待。
 *
 * @param {{ username: string, password: string, timeoutMs?: number }} options
 * @returns {string} 可直接交给 webContents.executeJavaScript 的脚本文本
 */
function buildAutoLoginScript ({ username, password, timeoutMs = 20000 }) {
  const cfg = JSON.stringify({ username, password, timeoutMs })

  return `(async () => {
  const cfg = ${cfg};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const isVisible = (el) => {
    if (!el || el.disabled) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const visibleInputs = () =>
    Array.from(document.querySelectorAll('input')).filter(isVisible);

  const findPassword = () => visibleInputs().find((el) => el.type === 'password') || null;

  const findUsername = (passwordInput) => {
    const selectors = [
      'input[autocomplete="username"]',
      'input[name*="user" i]',
      'input[id*="user" i]',
      'input[name*="account" i]',
      'input[id*="account" i]',
      'input[name*="login" i]',
      'input[placeholder*="账号"]',
      'input[placeholder*="用户名"]',
      'input[placeholder*="学号"]',
      'input[placeholder*="手机"]',
      'input[placeholder*="邮箱"]'
    ];
    for (const selector of selectors) {
      const el = Array.from(document.querySelectorAll(selector)).find(isVisible);
      if (el) return el;
    }
    const textLike = visibleInputs().filter((el) =>
      ['text', 'tel', 'email', 'number', 'search'].includes(el.type)
    );
    if (passwordInput) {
      const form = passwordInput.closest('form');
      if (form) {
        const inForm = textLike.find((el) => form.contains(el));
        if (inForm) return inForm;
      }
      const container = passwordInput.parentElement && passwordInput.parentElement.parentElement;
      if (container) {
        const nearby = textLike.find((el) => container.contains(el));
        if (nearby) return nearby;
      }
    }
    return textLike[0] || null;
  };

  // React/Vue 等框架会劫持 value 的 setter，必须走原生 setter + 事件派发
  const setNativeValue = (el, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };

  const SUBMIT_TEXTS = ['登录', '登 录', '立即登录', '登陆', '登入', 'login', 'signin', 'sign in'];

  const pressEnter = (el) => {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, {
        bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13
      }));
    }
  };

  const submitLogin = (passwordInput) => {
    const form = passwordInput ? passwordInput.closest('form') : null;
    if (form) {
      const submitter = Array.from(form.querySelectorAll('button, input[type="submit"], input[type="button"]'))
        .filter(isVisible)
        .find((el) => {
          const text = (el.textContent || el.value || '').replace(/\\s/g, '').toLowerCase();
          return el.type === 'submit' || SUBMIT_TEXTS.some((t) => text.includes(t.replace(/\\s/g, '')));
        });
      if (submitter) {
        submitter.click();
        return 'form-submit-button';
      }
    }
    const clickable = Array.from(document.querySelectorAll('button, [role="button"], a, input[type="submit"], input[type="button"]'))
      .filter(isVisible)
      .find((el) => {
        const text = (el.textContent || el.value || '').replace(/\\s/g, '').toLowerCase();
        return SUBMIT_TEXTS.some((t) => text.includes(t.replace(/\\s/g, '')));
      });
    if (clickable) {
      clickable.click();
      return 'button';
    }
    if (form) {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return 'form';
    }
    if (passwordInput) {
      pressEnter(passwordInput);
      return 'enter';
    }
    return 'none';
  };

  const deadline = Date.now() + cfg.timeoutMs;
  let lastFoundPassword = null;

  while (Date.now() < deadline) {
    const passwordInput = findPassword();
    if (passwordInput) {
      // 上一轮已填过且值仍在，说明提交没生效，下一轮重新触发一次
      if (lastFoundPassword === passwordInput && passwordInput.dataset.xiaoxiaoyunFilled === '1') {
        await sleep(600);
        continue;
      }
      const usernameInput = findUsername(passwordInput);
      if (usernameInput && cfg.username) {
        setNativeValue(usernameInput, cfg.username);
      }
      setNativeValue(passwordInput, cfg.password);
      passwordInput.dataset.xiaoxiaoyunFilled = '1';
      lastFoundPassword = passwordInput;
      await sleep(120);
      const method = submitLogin(passwordInput);
      return { ok: true, method, usernameField: Boolean(usernameInput) };
    }
    await sleep(400);
  }

  return { ok: false, reason: 'no-login-form' };
})()`
}

module.exports = { buildAutoLoginScript }

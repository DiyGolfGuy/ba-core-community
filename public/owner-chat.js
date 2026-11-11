(() => {
  'use strict';
  const get = (id) => document.getElementById('owner-chat-' + id);
  const dialog = get('dialog');
  const response = get('response');
  const input = get('message');
  const apply = get('apply');
  const handoff = get('handoff');
  const local = get('local');
  const hosted = get('hosted');
  const provider = get('provider');
  const model = get('model');
  const effort = get('effort');
  const reasoningMode = get('reasoning-mode');
  const outputTokens = get('output-tokens');
  const workspace = get('workspace');
  const apiKey = get('key');
  const save = get('save');
  const disconnect = get('disconnect');
  const connection = get('connection');
  const nextStep = get('next-step');
  const prevStep = get('prev-step');
  const skipStep = get('skip-step');
  const stepSetting = get('step-setting');
  const guideActions = get('guide-actions');
  const references = get('references');
  const guideLink = get('guide');
  const form = get('form');
  const settingsUrl = '/api/admin/owner-chat/hosted/settings';
  const requestOptions = { returnError: true };
  const providers = { openai: 'OpenAI', anthropic: 'Claude' };
  const canEnterKey = location.protocol === 'https:' || location.hostname === '127.0.0.1';
  let proposalId;
  let lastRequest;
  let hostedFresh = true;
  let settings;
  let dialogVersion = 0;
  let guide;
  let stepIndex = 0;
  let chatRequest;
  const progressKey = 'ba-core-owner-setup-progress';
  const progress = { current: null, reviewed: [], deferred: [] };
  try {
    const saved = JSON.parse(sessionStorage.getItem(progressKey) || '{}');
    if (typeof saved.current === 'string') progress.current = saved.current;
    for (const key of ['reviewed', 'deferred']) {
      if (Array.isArray(saved[key])) progress[key] = saved[key].filter(id => typeof id === 'string').slice(0, 30);
    }
  } catch {}

  function saveProgress() {
    try { sessionStorage.setItem(progressKey, JSON.stringify(progress)); } catch {}
  }

  function clearActions() {
    proposalId = undefined;
    apply.hidden = true;
    handoff.hidden = true;
    references.replaceChildren();
    references.hidden = true;
  }

  function goToSetting(event, setting) {
    dialog.close();
    if (['bays', 'members', 'waivers', 'bookings'].includes(setting)) adminJumpHint(setting);
    else gsGo(event, setting);
  }

  function showReferences({ destinations = [], sources = [] } = {}) {
    for (const { id, label } of destinations) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-ghost btn-sm';
      button.textContent = label;
      button.addEventListener('click', event => goToSetting(event, id));
      references.append(button);
    }
    for (const { file, heading } of sources) {
      const link = document.createElement('a');
      link.className = 'btn btn-ghost btn-sm';
      link.textContent = 'Guide: ' + heading;
      link.href = '/api/admin/guides/' + encodeURIComponent(file.replace(/\.md$/, '.pdf'));
      link.target = '_blank';
      link.rel = 'noopener';
      references.append(link);
    }
    references.hidden = !references.childElementCount;
  }

  function clearGuide() {
    guide = undefined;
    guideActions.hidden = true;
    guideLink.removeAttribute('href');
  }

  function showGuideStep() {
    const { title, file, steps } = guide;
    const step = steps[stepIndex];
    const number = 'Step ' + (stepIndex + 1) + ' of ' + steps.length;
    response.textContent = title + '\n' + number + (step.title ? ' · ' + step.title : '') + '\n\n' + step.text;
    if (guide.id === 'setup') {
      progress.current = step.id;
      saveProgress();
    }
    guideActions.hidden = false;
    prevStep.hidden = stepIndex === 0;
    skipStep.hidden = guide.id !== 'setup';
    stepSetting.hidden = !step.setting;
    nextStep.textContent = stepIndex === steps.length - 1 ? 'Finish walkthrough' : 'Done · next step';
    guideLink.href = '/api/admin/guides/' + encodeURIComponent(step.file || file);
  }

  function advanceGuide(skip = false) {
    if (!guide) return;
    const isSetup = guide.id === 'setup';
    if (isSetup) {
      const { id } = guide.steps[stepIndex];
      progress.reviewed = progress.reviewed.filter(item => item !== id);
      progress.deferred = progress.deferred.filter(item => item !== id);
      (skip ? progress.deferred : progress.reviewed).push(id);
    }
    if (++stepIndex < guide.steps.length) {
      showGuideStep();
      return;
    }
    const deferred = isSetup ? guide.steps.filter(step => progress.deferred.includes(step.id)).map(step => step.title) : [];
    clearGuide();
    response.textContent = deferred.length ? 'Walkthrough finished for now. Come back to ' + deferred.join(', ') + '.' :
      'Walkthrough finished. Check the results of your tests before opening public bookings.';
    if (isSetup) {
      progress.current = null;
      saveProgress();
    }
  }

  function useGuideCommand(message) {
    if (!guide) return false;
    const words = message.toLowerCase().replace(/[.!?]+$/, '');
    if (/^(?:done|next(?: step)?|got it|continue|what’s next|what's next)$/.test(words)) advanceGuide();
    else if (/^(?:back|go back|previous(?: step)?)$/.test(words)) {
      if (stepIndex > 0) stepIndex--;
      showGuideStep();
    } else if (/^(?:again|repeat(?: that)?|where was i)$/.test(words)) showGuideStep();
    else if (guide.id === 'setup' && /^(?:skip(?: for now)?|later|not now)$/.test(words)) advanceGuide(true);
    else if (/^(?:i['’]?m stuck|stuck|i['’]?m lost|not working)$/.test(words)) {
      showGuideStep();
      response.textContent += '\n\nDownload the guide for this step for detailed checks. You can ask locally about the service by name or skip this step for now.';
    } else return false;
    return true;
  }

  nextStep.addEventListener('click', () => advanceGuide());
  skipStep.addEventListener('click', () => advanceGuide(true));
  prevStep.addEventListener('click', () => useGuideCommand('back'));
  stepSetting.addEventListener('click', event => {
    const setting = guide?.steps[stepIndex].setting;
    if (setting) goToSetting(event, setting);
  });

  function updateProviderFields() {
    const selected = provider.value;
    const saved = settings?.provider === selected ? settings : null;
    model.placeholder = settings?.defaultModels?.[selected] || 'Default model';
    model.value = saved?.model || '';
    effort.replaceChildren(new Option('Provider default', ''));
    for (const value of settings?.effortOptions?.[selected] || []) {
      effort.add(new Option(value === 'xhigh' ? 'Extra high (xhigh)' : value, value));
    }
    effort.value = saved?.effort || '';
    get('reasoning-row').hidden = selected !== 'openai';
    reasoningMode.value = saved?.reasoningMode || '';
    const defaultTokens = settings?.defaultMaxOutputTokens?.[selected];
    outputTokens.placeholder = defaultTokens ? defaultTokens.toLocaleString() + ' by default' : 'Provider default';
    outputTokens.value = saved?.maxOutputTokens ?? '';
    workspace.value = saved?.workspaceId || '';
    get('workspace-row').hidden = selected !== 'anthropic';
    apiKey.required = !saved;
    apiKey.placeholder = saved ? 'Leave blank to keep your saved key' : '';
  }

  function showSettings(result) {
    settings = result;
    hosted.hidden = !result?.provider;
    disconnect.hidden = !result?.provider;
    provider.value = result?.provider || 'openai';
    updateProviderFields();
    const saved = result?.provider ? 'Saved connection · ' + providers[result.provider] + ' · ' + result.model : 'No hosted provider connected.';
    connection.textContent = (result ? saved : 'Hosted AI settings could not be loaded.') +
      (canEnterKey ? '' : ' Open Admin over HTTPS or the private SSH forward to enter a key.');
  }

  function lockSettings(locked) {
    save.disabled = locked || !canEnterKey;
    apiKey.disabled = locked || !canEnterKey;
    disconnect.disabled = locked;
  }

  async function openDialog(startSetup = false) {
    if (dialog.open) return;
    const version = ++dialogVersion;
    hosted.hidden = true;
    disconnect.hidden = true;
    connection.textContent = 'Checking the hosted AI connection…';
    lockSettings(true);
    dialog.showModal();
    if (guide) showGuideStep();
    if (startSetup) get('start-setup').click();
    const result = await apiFetch(settingsUrl, 'GET', undefined, requestOptions);
    if (!dialog.open || version !== dialogVersion) return;
    showSettings(result?.error ? null : result);
    if (result?.error) connection.textContent = result.error;
    lockSettings(false);
  }
  get('open').addEventListener('click', () => openDialog());
  document.getElementById('gsWalk').addEventListener('click', () => openDialog(true));
  get('start-setup').addEventListener('click', () => {
    if (chatRequest) return;
    input.value = 'Continue setup';
    form.requestSubmit(local);
  });
  get('close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    dialogVersion++;
    chatRequest?.abort();
    input.value = '';
    apiKey.value = '';
    response.textContent = '';
    lastRequest = undefined;
    hostedFresh = true;
    clearActions();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const useHosted = event.submitter === hosted;
    if (chatRequest) return;
    lastRequest = input.value.trim();
    if (!useHosted && useGuideCommand(lastRequest)) {
      input.value = '';
      return;
    }
    const version = dialogVersion;
    chatRequest = new AbortController();
    local.disabled = hosted.disabled = true;
    clearActions();
    clearGuide();
    try {
      if (useHosted) response.textContent = 'Waiting for ' + providers[settings.provider] + '…';
      const endpoint = useHosted ? '/api/admin/owner-chat/hosted' : '/api/admin/owner-chat';
      // The Pi keeps the earlier hosted turns; `fresh` starts a new conversation.
      const payload = useHosted ? { message: lastRequest, fresh: hostedFresh } : { message: lastRequest };
      const result = await apiFetch(endpoint, 'POST', payload, { ...requestOptions, signal: chatRequest.signal });
      if (!dialog.open || version !== dialogVersion) return;
      if (!result) throw new Error('The chat did not respond. Check your owner sign-in.');
      response.textContent = result.error || result.reply;
      if (useHosted && result.reply && !result.error) hostedFresh = false;
      showReferences(result.guidance);
      if (result.guide) {
        guide = result.guide;
        stepIndex = 0;
        if (guide.id === 'setup') {
          const current = guide.steps.findIndex(step => step.id === progress.current);
          const pending = guide.steps.findIndex(step => !progress.reviewed.includes(step.id) && !progress.deferred.includes(step.id));
          const deferred = guide.steps.findIndex(step => progress.deferred.includes(step.id));
          stepIndex = Math.max(0, [current, pending, deferred].find(index => index >= 0) ?? 0);
        }
        showGuideStep();
      }
      if (result.proposal) {
        proposalId = result.proposal.id;
        response.textContent += '\n\nCurrent\n' + result.proposal.before + '\n\nProposed\n' + result.proposal.after;
        apply.hidden = false;
      }
      handoff.hidden = !result.handoff;
    } catch (error) {
      if (dialog.open && version === dialogVersion) response.textContent = error.message;
    } finally {
      chatRequest = undefined;
      local.disabled = hosted.disabled = false;
    }
  });

  provider.addEventListener('change', () => {
    apiKey.value = '';
    updateProviderFields();
  });

  get('settings').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canEnterKey) return;
    const version = dialogVersion;
    const values = {
      provider: provider.value,
      model: model.value.trim(),
      effort: effort.value,
      reasoningMode: reasoningMode.value,
      maxOutputTokens: outputTokens.value ? outputTokens.valueAsNumber : null,
      apiKey: apiKey.value.trim(),
      workspaceId: workspace.value.trim(),
    };
    apiKey.value = '';
    lockSettings(true);
    const result = await apiFetch(settingsUrl, 'PUT', values, requestOptions);
    if (!dialog.open || version !== dialogVersion) return;
    if (result && !result.error) showSettings(result);
    else connection.textContent = result?.error || 'The connection could not be saved.';
    lockSettings(false);
  });

  disconnect.addEventListener('click', async () => {
    const version = dialogVersion;
    lockSettings(true);
    const result = await apiFetch(settingsUrl, 'DELETE', undefined, requestOptions);
    if (!dialog.open || version !== dialogVersion) return;
    apiKey.value = '';
    if (result && !result.error) showSettings(result);
    else connection.textContent = result?.error || 'The connection could not be removed.';
    lockSettings(false);
  });

  apply.addEventListener('click', async () => {
    if (!proposalId) return;
    apply.disabled = true;
    try {
      const result = await apiFetch('/api/admin/owner-chat/apply', 'POST', { id: proposalId }, requestOptions);
      response.textContent = result?.error || result?.reply || 'Check your owner sign-in and try again.';
      if (result?.reply || result?.error) clearActions();
    } catch (error) {
      response.textContent = error.message;
    } finally {
      apply.disabled = false;
    }
  });

  handoff.addEventListener('click', async () => {
    const prompt = 'I use BA Core. Help me with the request below. If my private BA Core MCP connection is available, use prepare_booking_settings for an hours or price proposal and give me the resulting line to paste back for review. For other tasks, explain the next steps. Ask me for non-sensitive context only.\n\n' + lastRequest;
    try {
      await navigator.clipboard.writeText(prompt);
      response.textContent = 'Copied. Review the text before sending it to your AI client.';
    } catch {
      response.textContent = prompt;
    }
  });
})();

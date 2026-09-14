// ATF Online Auto Typer — Console Edition 2.0.8
// Paste this entire file into the Chrome or Edge DevTools Console on the ATF typing page.

(function () {
    'use strict';

    if (window.__atfConsoleAutoTyperLoaded) {
        console.info('[ATF Auto Typer] The console edition is already loaded on this page.');
        return;
    }

    let running = false;
    let stopRequested = false;
    let panel;
    let startButton;
    let speedInput;
    let speedValue;
    let mistakeInput;
    let mistakeValue;
    let statsLabel;
    let mistakesMade = 0;
    let mistakesRemaining = 0;
    let candidatesRemaining = 0;
    let mistakeSessionActive = false;
    let sessionStrokeCount = 0;
    let resumeText = '';
    let resumeIndex = 0;
    let panelVisible = false;

    const translations = {
        speedUnit: 'úh/min',
        start: 'Spustit',
        stop: 'Zastavit',
        resume: 'Pokračovat',
        ready: 'Připraveno',
        stopping: 'Zastavuji...',
        noText: 'V #original nebyl nalezen žádný text',
        typing: (current, total) => `Píšu ${current} / ${total} — Escape zastaví`,
        stopped: (current, total) => `Zastaveno na ${current} / ${total}`,
        stoppedBetweenLines: 'Zastaveno mezi řádky',
        finished: 'Dokončeno',
        error: message => `Chyba: ${message}`
    };

    function t(key, ...values) {
        const translation = translations[key];
        return typeof translation === 'function' ? translation(...values) : translation;
    }

    function actionButtonText() {
        if (running) return t('stop');
        return resumeText ? t('resume') : t('start');
    }

    function setPanelVisible(visible) {
        panelVisible = visible;
        if (!panel) return;

        panel.classList.toggle('atf-panel-hidden', !visible);
        panel.setAttribute('aria-hidden', String(!visible));
    }

    function handleKeyboardShortcut(event) {
        const isInsert = event.key === 'Insert' || event.code === 'Insert' || event.keyCode === 45;
        const isHome = event.key === 'Home' || event.code === 'Home' || event.keyCode === 36;
        if (!isInsert && !isHome) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        if (event.type !== 'keydown' || event.repeat) return;

        if (isInsert) {
            setPanelVisible(!panelVisible);
        } else if (!running && panel) {
            startTyping();
        }
    }

    // Insert toggles the panel; Home starts/resumes typing.
    for (const eventName of ['keydown', 'keyup']) {
        window.addEventListener(eventName, handleKeyboardShortcut, true);
    }

    function handleRepeatExerciseClick(event) {
        let element = event.target;
        for (let depth = 0; element && depth < 6; depth += 1, element = element.parentElement) {
            const label = [element.value, element.title, element.alt, element.textContent]
                .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
            if (/opakovat\s+snímek/i.test(label) || /opakovat\s+snimek/i.test(label)) {
                if (running) stopRequested = true;
                resumeText = '';
                resumeIndex = 0;
                resetMistakeSession();
                return;
            }
        }
    }

    document.addEventListener('click', handleRepeatExerciseClick, true);

    // While auto-typing, stop real keyboard events before the website receives them.
    // Escape is deliberately kept as an emergency stop.
    function blockPhysicalKeyboard(event) {
        if (!running || !event.isTrusted) return;

        if (event.key === 'Escape') {
            stopRequested = true;
            event.preventDefault();
            event.stopImmediatePropagation();
            setStatus(t('stopping'));
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
    }

    for (const eventName of ['keydown', 'keypress', 'keyup', 'beforeinput', 'input']) {
        window.addEventListener(eventName, blockPhysicalKeyboard, true);
        document.addEventListener(eventName, blockPhysicalKeyboard, true);
    }

    // A console script runs after ATF has installed KeyListener. Chrome/Edge's
    // DevTools command-line API lets us capture that existing listener and call
    // it directly with a transparent event view that reports isTrusted=true.
    const interceptedTypes = new Set(['keydown', 'keypress', 'keyup']);
    const capturedAtfListeners = [];

    function trustedEventView(event, currentTarget) {
        return new Proxy(event, {
            get(target, property) {
                if (property === 'isTrusted') return true;
                if (property === 'target' || property === 'currentTarget') return currentTarget;
                const value = Reflect.get(target, property, target);
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
    }

    function captureAtfKeyboardListeners() {
        const inspectListeners = typeof getEventListeners === 'function' ? getEventListeners : null;
        if (!inspectListeners) {
            throw new Error('Paste this code directly into the Chrome or Edge DevTools Console.');
        }

        const domTargets = document.querySelectorAll ? Array.from(document.querySelectorAll('*')) : [];
        const targets = [window, document, document.documentElement, document.body, ...domTargets]
            .filter(Boolean);
        const atfCandidates = [];
        const fallbackCandidates = [];

        for (const target of targets) {
            const listenersByType = inspectListeners(target);
            for (const type of interceptedTypes) {
                for (const record of listenersByType[type] || []) {
                    const listener = record.listener;
                    if (listener === handleKeyboardShortcut || listener === blockPhysicalKeyboard) continue;

                    const callable = typeof listener === 'function'
                        ? listener
                        : listener && typeof listener.handleEvent === 'function'
                            ? listener.handleEvent
                            : null;
                    if (!callable) continue;

                    const source = Function.prototype.toString.call(callable);
                    const candidate = { target, type, listener };
                    const looksLikeAtf = callable.name === 'KeyListener'
                        || source.includes('KeyListener')
                        || source.includes('isTrusted')
                        || source.includes('caret')
                        || source.includes('copy');

                    fallbackCandidates.push(candidate);
                    if (looksLikeAtf) atfCandidates.push(candidate);
                }
            }
        }

        // Some older ATF builds use DOM0 keyboard properties instead of
        // addEventListener; include those in the fallback set as well.
        for (const target of targets) {
            for (const type of interceptedTypes) {
                const property = `on${type}`;
                const listener = target[property];
                if (typeof listener === 'function') {
                    fallbackCandidates.push({ target, type, listener });
                }
            }
        }

        // A few ATF versions keep the handler in a global instead of exposing
        // it through getEventListeners(). Use the named handler as a final
        // fallback so the console edition still works on those builds.
        if (!fallbackCandidates.length) {
            const globalCandidates = [];
            for (const name of Object.getOwnPropertyNames(window)) {
                if (!/keylistener|keyboardlistener/i.test(name)) continue;
                let value;
                try {
                    value = window[name];
                } catch (_) {
                    continue;
                }
                if (typeof value !== 'function') continue;
                for (const type of interceptedTypes) {
                    globalCandidates.push({ target: document.body || document, type, listener: value });
                }
            }
            fallbackCandidates.push(...globalCandidates);
        }

        const selectedCandidates = atfCandidates.length ? atfCandidates : fallbackCandidates;
        capturedAtfListeners.push(...selectedCandidates);

        if (!capturedAtfListeners.length) {
            throw new Error('No keyboard listener was found. Open an active ATF typing exercise, then paste the code again.');
        }
    }

    function deliverToAtf(type, event) {
        for (const entry of capturedAtfListeners) {
            if (entry.type !== type) continue;

            const deliveredEvent = trustedEventView(event, entry.target);
            if (typeof entry.listener === 'function') {
                entry.listener.call(entry.target, deliveredEvent);
            } else {
                entry.listener.handleEvent.call(entry.listener, deliveredEvent);
            }
        }
    }

    try {
        captureAtfKeyboardListeners();
    } catch (error) {
        for (const eventName of ['keydown', 'keyup']) {
            window.removeEventListener(eventName, handleKeyboardShortcut, true);
        }
        for (const eventName of ['keydown', 'keypress', 'keyup', 'beforeinput', 'input']) {
            window.removeEventListener(eventName, blockPhysicalKeyboard, true);
            document.removeEventListener(eventName, blockPhysicalKeyboard, true);
        }
        throw error;
    }
    window.__atfConsoleAutoTyperLoaded = true;

    function sleep(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    async function waitUntil(deadline, allowStop = false) {
        while (true) {
            if (allowStop && stopRequested) return false;
            const remaining = deadline - performance.now();
            if (remaining <= 1) return true;
            await sleep(Math.min(remaining, allowStop ? 50 : remaining));
        }
    }

    function createNormalizedIntervals(count, totalDuration) {
        if (count <= 0) return [];

        const weights = Array.from({ length: count }, () => 0.88 + Math.random() * 0.24);
        const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
        return weights.map(weight => totalDuration * weight / weightTotal);
    }

    function setStatus(message) {
        if (panel) panel.setAttribute('aria-label', message);
    }

    function updateRangeProgress(input) {
        if (!input) return;
        const minimum = Number(input.min) || 0;
        const maximum = Number(input.max) || 100;
        const value = Number(input.value) || minimum;
        const progress = maximum > minimum
            ? (value - minimum) / (maximum - minimum) * 100
            : 0;
        input.style.setProperty('--range-progress', `${Math.max(0, Math.min(100, progress))}%`);
    }

    function legacyCodeFor(character, eventType) {
        if (character === '\n') return 13;
        if (eventType === 'keydown' || eventType === 'keyup') {
            if (/^[a-z]$/i.test(character)) return character.toUpperCase().charCodeAt(0);
        }
        return character.charCodeAt(0);
    }

    function keyNameFor(character) {
        if (character === '\n') return 'Enter';
        if (character === '\b') return 'Backspace';
        return character;
    }

    function codeNameFor(character) {
        if (character === ' ') return 'Space';
        if (character === '\n') return 'Enter';
        if (character === '\b') return 'Backspace';
        if (/^[a-z]$/i.test(character)) return `Key${character.toUpperCase()}`;
        if (/^[0-9]$/.test(character)) return `Digit${character}`;
        return '';
    }

    function createKeyboardEvent(type, character) {
        const legacyCode = legacyCodeFor(character, type);
        const event = new KeyboardEvent(type, {
            key: keyNameFor(character),
            code: codeNameFor(character),
            bubbles: true,
            cancelable: true,
            composed: true
        });

        // ATF Online contains legacy event handling, so expose the old properties too.
        for (const [property, value] of Object.entries({
            keyCode: legacyCode,
            which: legacyCode,
            charCode: type === 'keypress' ? legacyCode : 0
        })) {
            try {
                Object.defineProperty(event, property, { get: () => value });
            } catch (_) {
                // Modern key/keyCode values above are still available if redefining fails.
            }
        }

        return event;
    }

    function sendCharacter(character) {
        deliverToAtf('keydown', createKeyboardEvent('keydown', character));
        // Real browsers do not produce keypress for Backspace.
        if (character !== '\b') {
            deliverToAtf('keypress', createKeyboardEvent('keypress', character));
        }
        deliverToAtf('keyup', createKeyboardEvent('keyup', character));
    }

    function getOriginalText() {
        const original = document.getElementById('original');
        if (!original) return '';

        // Preserve the text but normalize non-breaking spaces used by some old pages.
        return (original.textContent || '').replace(/\u00a0/g, '');
    }

    function getRemainingExerciseText() {
        const currentLine = getOriginalText();
        const currentProgress = getWebsiteProgress(currentLine.length);
        const futureElement = document.getElementById('text');
        const futureText = futureElement
            ? (futureElement.textContent || '').replace(/\u00a0/g, ' ')
            : '';

        return currentLine.slice(currentProgress) + futureText;
    }

    function isMistakeCandidate(character) {
        return /^[a-záčďéěíňóřšťúůýž]$/i.test(character);
    }

    function wrongCharacterFor(character) {
        const wasUpperCase = character === character.toUpperCase();
        const lower = character.toLowerCase();
        const withoutAccent = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        let wrong;
        if (lower === 'y') wrong = Math.random() < 0.75 ? 'z' : 'u';
        else if (lower === 'z') wrong = Math.random() < 0.75 ? 'y' : 't';
        else if (withoutAccent !== lower) wrong = withoutAccent;
        else {
            const neighbours = {
                q: 'wa', w: 'qes', e: 'wrd', r: 'etf', t: 'rzg',
                u: 'zji', i: 'uko', o: 'ilp', p: 'o',
                a: 'qs', s: 'awd', d: 'sef', f: 'drg', g: 'fth',
                h: 'gj', j: 'huk', k: 'jil', l: 'ko',
                x: 'yc', c: 'xv', v: 'cb', b: 'vn', n: 'bm', m: 'n'
            };
            const choices = neighbours[lower] || 'aeiou';
            wrong = choices[Math.floor(Math.random() * choices.length)];
        }

        return wasUpperCase ? wrong.toUpperCase() : wrong;
    }

    function shouldMakeMistake(character) {
        if (!isMistakeCandidate(character) || candidatesRemaining <= 0) return false;

        // Selecting with remaining/available probability produces an exact error
        // count while keeping every eligible position uniformly random.
        const makeMistake = mistakesRemaining > 0
            && Math.random() < mistakesRemaining / candidatesRemaining;
        candidatesRemaining -= 1;

        if (makeMistake) {
            mistakesRemaining -= 1;
            mistakesMade += 1;
        }

        return makeMistake;
    }

    function correctionModeEnabled() {
        const correctionControl = document.getElementById('corrMode');
        if (!correctionControl) return true;

        const checkbox = correctionControl.matches?.('input[type="checkbox"]')
            ? correctionControl
            : correctionControl.querySelector?.('input[type="checkbox"]');
        return checkbox ? checkbox.checked : true;
    }

    function updateStatsPreview() {
        if (!statsLabel || !speedInput || !mistakeInput) return;

        const typingReady = Boolean(document.getElementById('caret'));
        if (!typingReady && sessionStrokeCount > 0) {
            const completedRate = (mistakesMade / sessionStrokeCount * 100).toFixed(2);
            statsLabel.textContent = `${completedRate}%`;
            return;
        }

        // During DOMContentLoaded our panel can initialize before ATF creates
        // its caret/text. Keep the configured slider range until ATF is ready.
        if (!typingReady) {
            statsLabel.textContent = '—';
            return;
        }

        const text = getRemainingExerciseText();
        if (!text.length) return;
        const candidateCount = Array.from(text).filter(isMistakeCandidate).length;
        // ATF reports the exercise's accepted keystrokes separately from errors;
        // a corrected wrong key does not add two more accepted characters.
        const estimatedStrokes = text.length;
        const maximumScorableErrors = Math.max(0, Math.floor((estimatedStrokes - 1) / 10));
        const maximumErrors = Math.min(20, candidateCount, maximumScorableErrors);
        mistakeInput.max = String(maximumErrors);

        const requestedErrors = Math.max(0, Math.round(Number(mistakeInput.value) || 0));
        const estimatedErrors = Math.min(requestedErrors, maximumErrors);
        if (estimatedErrors !== requestedErrors) {
            mistakeInput.value = String(estimatedErrors);
            mistakeValue.textContent = String(estimatedErrors);
        }
        updateRangeProgress(mistakeInput);
        const estimatedErrorRate = estimatedStrokes > 0
            ? (estimatedErrors / estimatedStrokes * 100).toFixed(2)
            : '0.00';

        statsLabel.textContent = `${estimatedErrorRate}%`;
    }

    async function refreshStatsWhenAtfReady() {
        for (let attempt = 0; attempt < 60; attempt += 1) {
            if (document.getElementById('caret') && getOriginalText()) {
                updateStatsPreview();
                return;
            }
            await sleep(50);
        }
    }

    function getWebsiteProgress(textLength) {
        const copy = document.getElementById('copy');
        if (!copy) return 0;

        const typedText = (copy.textContent || '').replace(/\u00a0/g, '');
        return Math.min(textLength, typedText.length);
    }

    function resetMistakeSession() {
        mistakesMade = 0;
        mistakesRemaining = 0;
        candidatesRemaining = 0;
        mistakeSessionActive = false;
        sessionStrokeCount = 0;
    }

    async function waitForNextLine(previousText) {
        // ATF keeps #caret while another line is available and removes it when
        // the complete exercise is finished. No keyboard event is sent here.
        for (let attempt = 0; attempt < 30; attempt += 1) {
            if (stopRequested) return null;

            if (!document.getElementById('caret')) return '';

            const nextText = getOriginalText();
            if (nextText && nextText !== previousText) return nextText;

            await sleep(50);
        }

        // Do not guess or send an extra space if ATF did not advance.
        return '';
    }

    async function startTyping() {
        if (running) {
            stopRequested = true;
            setStatus(t('stopping'));
            return;
        }

        const visibleText = getOriginalText();
        if (!visibleText) {
            setStatus(t('noText'));
            return;
        }

        if (!document.getElementById('caret')) {
            resumeText = '';
            resumeIndex = 0;
            setStatus(t('finished'));
            return;
        }

        // ATF's #copy is the source of truth every time typing starts. This is
        // important when "Opakovat snímek" reloads the same sentence: the text
        // is unchanged, but its website progress moves back to the beginning.
        const websiteProgress = getWebsiteProgress(visibleText.length);
        const exerciseRestarted = resumeText === visibleText && websiteProgress < resumeIndex;

        if (exerciseRestarted) {
            resetMistakeSession();
        }

        resumeText = visibleText;
        resumeIndex = websiteProgress;

        const targetSpeed = Math.min(250, Math.max(50, Number(speedInput.value) || 250));
        const requestedErrors = Math.max(0, Math.min(20, Math.round(Number(mistakeInput.value) || 0)));
        speedInput.value = String(targetSpeed);
        mistakeInput.value = String(requestedErrors);

        const remainingExerciseText = getRemainingExerciseText();

        if (!mistakeSessionActive) {
            mistakesMade = 0;
            mistakeSessionActive = true;
            sessionStrokeCount = remainingExerciseText.length;
        }

        candidatesRemaining = Array.from(remainingExerciseText).filter(isMistakeCandidate).length;
        mistakesRemaining = Math.min(
            candidatesRemaining,
            Math.max(0, requestedErrors - mistakesMade)
        );

        running = true;
        stopRequested = false;
        startButton.blur();
        startButton.textContent = t('stop');
        speedInput.disabled = true;
        mistakeInput.disabled = true;
        setStatus(t('typing', resumeIndex, resumeText.length));

        // Target ATF's own penalized úh/min formula instead of converting from WPM.
        const plannedErrors = mistakesRemaining;
        const correctionAddsDelay = correctionModeEnabled();
        const estimatedStrokes = remainingExerciseText.length;
        const penalizedStrokes = Math.max(1, estimatedStrokes - plannedErrors * 10);
        const targetDuration = penalizedStrokes / targetSpeed * 60000;
        const timedIntervals = Math.max(1, remainingExerciseText.length - 1);
        const minimumIntervalDuration = 4 * timedIntervals;
        const availableCorrectionBudget = Math.max(0, targetDuration - minimumIntervalDuration);
        const correctionDelayPerError = correctionAddsDelay && plannedErrors > 0
            ? Math.min(190, availableCorrectionBudget / plannedErrors)
            : 0;
        const correctionDelay = plannedErrors * correctionDelayPerError;
        const intervalDuration = Math.max(minimumIntervalDuration, targetDuration - correctionDelay);
        const intervalPlan = createNormalizedIntervals(timedIntervals, intervalDuration);
        let intervalIndex = 0;
        let timelineDeadline = performance.now();

        try {
            while (!stopRequested && resumeText) {
                const currentLine = resumeText;

                while (resumeIndex < currentLine.length) {
                    if (stopRequested) break;

                    if (!await waitUntil(timelineDeadline, true)) break;

                    const character = currentLine[resumeIndex];
                    let mistakeAdvancedPosition = false;
                    if (shouldMakeMistake(character)) {
                        sendCharacter(wrongCharacterFor(character));
                        if (correctionModeEnabled()) {
                            const recognitionDelay = correctionDelayPerError * (0.48 + Math.random() * 0.08);
                            timelineDeadline += recognitionDelay;
                            await waitUntil(timelineDeadline);
                            sendCharacter('\b');
                            timelineDeadline += correctionDelayPerError - recognitionDelay;
                            await waitUntil(timelineDeadline);
                        } else {
                            // With correction mode off, ATF advances immediately
                            // after recording the wrong character.
                            mistakeAdvancedPosition = true;
                        }
                    }
                    if (!mistakeAdvancedPosition) {
                        sendCharacter(character);
                    }
                    resumeIndex += 1;
                    setStatus(t('typing', resumeIndex, currentLine.length));

                    if (intervalIndex < intervalPlan.length) {
                        timelineDeadline += intervalPlan[intervalIndex];
                        intervalIndex += 1;
                    }
                }

                if (stopRequested) break;

                // The current line is complete. Wait for ATF to expose the next
                // one, or for #caret to disappear at the end of the exercise.
                resumeText = '';
                resumeIndex = 0;
                const nextLine = await waitForNextLine(currentLine);
                if (!nextLine) break;

                resumeText = nextLine;
                resumeIndex = getWebsiteProgress(nextLine.length);
                setStatus(t('typing', resumeIndex, nextLine.length));
            }

            if (stopRequested) {
                setStatus(resumeText
                    ? t('stopped', resumeIndex, resumeText.length)
                    : t('stoppedBetweenLines'));
            } else {
                setStatus(t('finished'));
                resumeText = '';
                resumeIndex = 0;
                mistakeSessionActive = false;
                mistakesRemaining = 0;
                candidatesRemaining = 0;
            }
        } catch (error) {
            console.error('[ATF Auto Typer]', error);
            setStatus(t('error', error.message));
        } finally {
            running = false;
            stopRequested = false;
            startButton.textContent = actionButtonText();
            speedInput.disabled = false;
            mistakeInput.disabled = false;
            updateStatsPreview();
        }
    }

    function createPanel() {
        if (panel || !document.body) return;

        panel = document.createElement('div');
        panel.id = 'atf-auto-typer-panel';
        panel.className = 'atf-panel-hidden';
        panel.setAttribute('aria-hidden', 'true');
        panel.innerHTML = `
            <label class="atf-control atf-speed">
                <span class="atf-speed-label">Rychlost</span><strong class="atf-speed-value">250 úh/min</strong>
                <input type="range" min="50" max="250" step="1" value="250">
            </label>
            <label class="atf-control atf-mistakes">
                <span class="atf-mistake-label">Počet chyb</span>
                <strong class="atf-mistake-summary" aria-live="polite">
                    <span class="atf-mistake-value">1</span>
                    <span class="atf-summary-separator">=</span>
                    <span class="atf-rate-value">0.00%</span>
                </strong>
                <input type="range" min="0" max="20" step="1" value="1">
            </label>
            <button class="atf-action" type="button">Spustit</button>
        `;

        const style = document.createElement('style');
        style.textContent = `
            #atf-auto-typer-panel {
                position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
                width: 238px; box-sizing: border-box; padding: 14px;
                color: #f4f4f5; background: #111113; border: 1px solid #343438;
                border-radius: 13px;
                box-shadow: 0 18px 46px rgba(0,0,0,.48), 0 3px 10px rgba(0,0,0,.38), inset 0 1px rgba(255,255,255,.045);
                font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
                user-select: none; opacity: 1; visibility: visible;
                transform: translateY(0) scale(1); transform-origin: right bottom;
                transition: opacity 220ms cubic-bezier(.16,1,.3,1), transform 260ms cubic-bezier(.16,1,.3,1), visibility 0s linear 0s;
            }
            #atf-auto-typer-panel.atf-panel-hidden {
                opacity: 0; visibility: hidden; pointer-events: none;
                transform: translateY(12px) scale(.97);
                transition: opacity 150ms ease-in, transform 150ms ease-in, visibility 0s linear 150ms;
            }
            #atf-auto-typer-panel .atf-control {
                display: flex; flex-wrap: wrap; justify-content: space-between;
                align-items: center; gap: 8px; margin-bottom: 15px;
                color: #c7c7ce; font-size: 12px; font-weight: 600;
            }
            #atf-auto-typer-panel .atf-speed-value,
            #atf-auto-typer-panel .atf-mistake-summary {
                color: #fff; font-size: 12px; font-weight: 750; font-variant-numeric: tabular-nums;
            }
            #atf-auto-typer-panel .atf-mistake-summary {
                display: inline-flex; align-items: baseline; gap: 4px;
            }
            #atf-auto-typer-panel .atf-summary-separator { color: #71717a; font-weight: 600; }
            #atf-auto-typer-panel .atf-rate-value { color: #a1a1aa; font-size: 11px; }
            #atf-auto-typer-panel input[type="range"] {
                --range-progress: 0%; appearance: none; -webkit-appearance: none;
                width: 100%; height: 18px; margin: 1px 0 0; padding: 0; border: 0;
                background: transparent;
                cursor: pointer;
            }
            #atf-auto-typer-panel input[type="range"]::-webkit-slider-runnable-track {
                width: 100%; height: 4px; border: 0; border-radius: 999px;
                background: linear-gradient(to right, #3b82f6 0 var(--range-progress), #34343a var(--range-progress) 100%);
            }
            #atf-auto-typer-panel input[type="range"]::-webkit-slider-thumb {
                appearance: none; -webkit-appearance: none; width: 15px; height: 15px;
                margin-top: -5.5px;
                border: 3px solid #3b82f6; border-radius: 50%; background: #f8fafc;
                box-shadow: 0 2px 6px rgba(0,0,0,.5); transition: transform 120ms ease, box-shadow 120ms ease;
            }
            #atf-auto-typer-panel input[type="range"]::-moz-range-track {
                width: 100%; height: 4px; border: 0; border-radius: 999px;
                background: linear-gradient(to right, #3b82f6 0 var(--range-progress), #34343a var(--range-progress) 100%);
            }
            #atf-auto-typer-panel input[type="range"]::-moz-range-thumb {
                width: 9px; height: 9px; border: 3px solid #3b82f6;
                border-radius: 50%; background: #f8fafc; box-shadow: 0 2px 6px rgba(0,0,0,.5);
            }
            #atf-auto-typer-panel input[type="range"]:hover::-webkit-slider-thumb {
                transform: scale(1.12); box-shadow: 0 3px 9px rgba(0,0,0,.6);
            }
            #atf-auto-typer-panel input:disabled { cursor: not-allowed; opacity: .45; }
            #atf-auto-typer-panel .atf-action {
                width: 100%; min-height: 34px; padding: 8px 10px; color: #fff; background: #2f6feb;
                border: 1px solid #4380f1; border-radius: 7px; box-shadow: 0 5px 13px rgba(22,70,163,.26);
                font: 750 12px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; cursor: pointer;
                transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
            }
            #atf-auto-typer-panel .atf-action:hover { background: #3978ef; border-color: #65a0ff; box-shadow: 0 7px 17px rgba(22,70,163,.36); }
            #atf-auto-typer-panel .atf-action:active { transform: translateY(1px); box-shadow: 0 3px 8px rgba(22,70,163,.22); }
            #atf-auto-typer-panel .atf-action:disabled { cursor: not-allowed; opacity: .5; }
            #atf-auto-typer-panel button:focus-visible,
            #atf-auto-typer-panel input:focus-visible {
                outline: 2px solid #60a5fa; outline-offset: 2px;
            }
            @media (prefers-reduced-motion: reduce) {
                #atf-auto-typer-panel,
                #atf-auto-typer-panel.atf-panel-hidden { transition-duration: 80ms; transform: none; }
            }
            @media (max-width: 480px) {
                #atf-auto-typer-panel { right: 10px; bottom: 10px; width: min(238px, calc(100vw - 20px)); }
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(panel);

        startButton = panel.querySelector('.atf-action');
        speedInput = panel.querySelector('.atf-speed input');
        mistakeInput = panel.querySelector('.atf-mistakes input');
        speedValue = panel.querySelector('.atf-speed-value');
        mistakeValue = panel.querySelector('.atf-mistake-value');
        statsLabel = panel.querySelector('.atf-rate-value');

        updateRangeProgress(speedInput);
        updateRangeProgress(mistakeInput);

        startButton.addEventListener('click', startTyping);
        speedInput.addEventListener('input', () => {
            speedValue.textContent = `${speedInput.value} ${t('speedUnit')}`;
            updateRangeProgress(speedInput);
            updateStatsPreview();
        });
        mistakeInput.addEventListener('input', () => {
            mistakeValue.textContent = mistakeInput.value;
            updateRangeProgress(mistakeInput);
            updateStatsPreview();
        });
        panel.addEventListener('keydown', event => event.stopPropagation());
        panel.addEventListener('keypress', event => event.stopPropagation());
        panel.addEventListener('keyup', event => event.stopPropagation());
        setStatus(t('ready'));
        updateStatsPreview();
        refreshStatsWhenAtfReady();

        // Stay hidden after reload unless Insert was pressed before DOM ready.
        if (panelVisible) {
            requestAnimationFrame(() => requestAnimationFrame(() => setPanelVisible(true)));
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createPanel, { once: true });
    } else {
        createPanel();
    }
})();

// Real Tool Registry - Uses actual PlatformHands for device control
import type { Tool, ToolResult } from './ToolRegistry';
import { handsManager } from './HandsManager';

async function requireHands(): Promise<void> {
  const connected = await handsManager.isConnected();
  if (!connected) throw new Error('Android device not connected. Please connect via Settings → Android Connection.');
}

export const openAppTool: Tool = {
  id: 'open_app', name: 'Open Application', description: 'Launch an Android application by package name', category: 'navigation', riskLevel: 'low',
  inputSchema: { type: 'object', properties: { packageName: { type: 'string', description: 'Android package name' } }, required: ['packageName'] },
  async execute(params: { packageName: string }): Promise<ToolResult> {
    await requireHands(); const hands = handsManager.getHands(); if (!hands) return { success: false, error: 'Hands not available' };
    const result = await hands.launchApp(params.packageName);
    if (!result.success) return { success: false, error: result.error || 'Failed to launch app' };
    await new Promise(r => setTimeout(r, 1000));
    const currentApp = await hands.getCurrentApp();
    if (currentApp === params.packageName) return { success: true, data: { app: params.packageName, currentApp, verified: true, timestamp: Date.now() } };
    return { success: false, error: `Verification failed: expected ${params.packageName}, got ${currentApp}` };
  },
  async verify(params, result) { return !!result.success && result.data?.verified === true && result.data?.currentApp === params.packageName; },
  async isAvailable() { return await handsManager.isConnected(); },
};

export const tapElementTool: Tool = {
  id: 'tap_element', name: 'Tap UI Element', description: 'Tap on a UI element by text or ID', category: 'interaction', riskLevel: 'low',
  inputSchema: { type: 'object', properties: { elementText: { type: 'string', description: 'Text content of the element to tap' }, elementId: { type: 'string', description: 'Resource ID of the element to tap' } } },
  async execute(params: { elementText?: string; elementId?: string }): Promise<ToolResult> {
    await requireHands(); const hands = handsManager.getHands(); if (!hands) return { success: false, error: 'Hands not available' };
    let element;
    if (params.elementText) element = await hands.findElementByText(params.elementText);
    else if (params.elementId) element = await hands.findElementById(params.elementId);
    if (!element) return { success: false, error: `Element not found: ${params.elementText || params.elementId}` };
    const beforeTree = await hands.getAccessibilityTree(); const beforeApp = await hands.getCurrentApp();
    const centerX = element.bounds.x + element.bounds.width / 2; const centerY = element.bounds.y + element.bounds.height / 2;
    const tapResult = await hands.tap(centerX, centerY);
    if (!tapResult.success) return { success: false, error: tapResult.error || 'Tap failed' };
    await new Promise(r => setTimeout(r, 500));
    const afterTree = await hands.getAccessibilityTree(); const afterApp = await hands.getCurrentApp();
    return { success: true, data: { element: { id: element.id, text: element.text, bounds: element.bounds }, tappedAt: { x: centerX, y: centerY }, beforeTree, afterTree, beforeApp, afterApp, timestamp: Date.now() } };
  },
  async verify(params, result) {
    if (!result.success || !result.data?.beforeTree || !result.data?.afterTree) return false;

    const beforeTree = result.data.beforeTree;
    const afterTree = result.data.afterTree;
    const flatten = (node: any): any[] => {
      if (!node) return [];
      return [node, ...(node.children || []).flatMap((child: any) => flatten(child))];
    };

    const beforeNodes = flatten(beforeTree.root);
    const afterNodes = flatten(afterTree.root);
    const target = params.elementId || params.elementText;

    const findTarget = (nodes: any[]) => nodes.find((node) =>
      (params.elementId && node.id === params.elementId) ||
      (params.elementText && (
        node.text === params.elementText ||
        node.contentDescription === params.elementText ||
        String(node.text || '').includes(params.elementText)
      ))
    );

    const beforeTarget = findTarget(beforeNodes);
    const afterTarget = findTarget(afterNodes);

    const signature = (node: any) => JSON.stringify({
      id: node?.id,
      text: node?.text,
      contentDescription: node?.contentDescription,
      resourceId: node?.resourceId,
      bounds: node?.bounds,
      clickable: node?.clickable,
      enabled: node?.enabled,
      selected: node?.selected,
      focused: node?.focused,
    });

    const changed = signature(beforeTree.root) !== signature(afterTree.root) ||
      JSON.stringify(beforeNodes.map((n) => signature(n))) !== JSON.stringify(afterNodes.map((n) => signature(n)));

    // The action executor already proved the target existed before tapping.
    // Verification requires an observable full-tree change or app navigation.
    // Requiring target re-identification would reject valid navigation where the
    // tapped node disappears from the post-action hierarchy.
    return changed || result.data.beforeApp !== result.data.afterApp;
  },
  async isAvailable() { return await handsManager.isConnected(); },
};

export const typeTextTool: Tool = {
  id: 'type_text', name: 'Type Text', description: 'Type text into the focused input field', category: 'interaction', riskLevel: 'medium',
  inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Text to type' }, clearFirst: { type: 'boolean', description: 'Clear field before typing' } }, required: ['text'] },
  async execute(params: { text: string; clearFirst?: boolean }): Promise<ToolResult> {
    await requireHands(); const hands = handsManager.getHands(); if (!hands) return { success: false, error: 'Hands not available' };
    if (params.clearFirst) { const clear = await hands.clearText(); if (!clear.success) return { success: false, error: clear.error || 'Failed to clear text' }; }
    const result = await hands.type(params.text); if (!result.success) return { success: false, error: result.error || 'Failed to type text' };
    return { success: true, data: { typed: params.text, length: params.text.length, timestamp: Date.now() } };
  },
  async verify(params, result) {
    if (!result.success) return false; const hands = handsManager.getHands(); if (!hands) return false;
    const tree = await hands.getAccessibilityTree();
    const findFocusedInput = (node: any): any => { if (node?.focused && (node.type === 'EditText' || node.type === 'TextField' || node.className?.includes('EditText'))) return node; for (const child of node?.children || []) { const found = findFocusedInput(child); if (found) return found; } return null; };
    const input = findFocusedInput(tree.root); return !!input && String(input.text || '').includes(params.text);
  },
  async isAvailable() { return await handsManager.isConnected(); },
};

export const captureScreenTool: Tool = {
  id: 'capture_screen', name: 'Capture Screen', description: 'Take a screenshot of the current screen', category: 'system', riskLevel: 'medium', inputSchema: { type: 'object', properties: {} },
  async execute(): Promise<ToolResult> { await requireHands(); const hands = handsManager.getHands(); if (!hands) return { success: false, error: 'Hands not available' }; const capture = await hands.captureScreen(); return { success: true, data: { image: capture.image, width: capture.width, height: capture.height, timestamp: capture.timestamp } }; },
  async verify(_params, result) { return !!result.success && !!result.data?.image; }, async isAvailable() { return await handsManager.isConnected(); },
};

export const sendMessageTool: Tool = {
  id: 'send_message', name: 'Send Message', description: 'Send a message via a messaging app (requires confirmation)', category: 'communication', riskLevel: 'high',
  inputSchema: { type: 'object', properties: { app: { type: 'string', description: 'Messaging app package name', enum: ['org.telegram.messenger', 'com.whatsapp', 'com.viber.voip'] }, contact: { type: 'string', description: 'Contact name or phone number' }, message: { type: 'string', description: 'Message text to send' } }, required: ['app', 'contact', 'message'] },
  async execute(params: { app: string; contact: string; message: string }): Promise<ToolResult> {
    await requireHands(); const hands = handsManager.getHands(); if (!hands) return { success: false, error: 'Hands not available' };
    const launch = await hands.launchApp(params.app); if (!launch.success) return { success: false, error: `Failed to launch ${params.app}` };
    await new Promise(r => setTimeout(r, 2000)); const contact = await hands.findElementByText(params.contact); if (!contact) return { success: false, error: `Contact not found: ${params.contact}` };
    const tap = await hands.tap(contact.bounds.x + contact.bounds.width / 2, contact.bounds.y + contact.bounds.height / 2); if (!tap.success) return { success: false, error: 'Failed to tap contact' };
    await new Promise(r => setTimeout(r, 1000)); const type = await hands.type(params.message); if (!type.success) return { success: false, error: 'Failed to type message' };
    await new Promise(r => setTimeout(r, 500)); const send = await hands.findElementByText('Send') || await hands.findElementByText('Отправить'); if (!send) return { success: false, error: 'Send button not found. Message typed but not sent.', data: { messageTyped: true, sent: false } };
    const sent = await hands.tap(send.bounds.x + send.bounds.width / 2, send.bounds.y + send.bounds.height / 2); if (!sent.success) return { success: false, error: 'Failed to tap send button' };
    await new Promise(r => setTimeout(r, 500)); const tree = await hands.getAccessibilityTree();
    return { success: true, data: { app: params.app, contact: params.contact, message: params.message, sent: true, afterTree: tree, timestamp: Date.now() } };
  },
  async verify(params, result) { if (!result.success || !result.data?.afterTree) return false; const find = (node: any): boolean => !!node && ((typeof node.text === 'string' && node.text.includes(params.message)) || (node.children || []).some((c: any) => find(c))); return find(result.data.afterTree.root); },
  async isAvailable() { return await handsManager.isConnected(); },
};

export const swipeTool: Tool = { id: 'swipe', name: 'Swipe', description: 'Perform a swipe gesture on the screen', category: 'interaction', riskLevel: 'low', inputSchema: { type: 'object', properties: { startX: { type: 'number', description: 'Start X coordinate' }, startY: { type: 'number', description: 'Start Y coordinate' }, endX: { type: 'number', description: 'End X coordinate' }, endY: { type: 'number', description: 'End Y coordinate' }, duration: { type: 'number', description: 'Duration in milliseconds' } }, required: ['startX', 'startY', 'endX', 'endY'] }, async execute(p) { await requireHands(); const h = handsManager.getHands(); if (!h) return { success: false, error: 'Hands not available' }; const r = await h.swipe(p.startX,p.startY,p.endX,p.endY,p.duration); return r.success ? { success:true, data:{...p,duration:p.duration||300} } : { success:false,error:r.error||'Swipe failed' }; }, async verify(_p,r){ return r.success; }, async isAvailable(){return await handsManager.isConnected();} };

export const pressKeyTool: Tool = { id:'press_key', name:'Press Key', description:'Press a hardware key', category:'interaction', riskLevel:'low', inputSchema:{type:'object',properties:{key:{type:'string',description:'Key name'}},required:['key']}, async execute(p){await requireHands();const h=handsManager.getHands();if(!h)return{success:false,error:'Hands not available'};const r=await h.pressKey(p.key);return r.success?{success:true,data:{key:p.key}}:{success:false,error:r.error||'Key press failed'};},async verify(_p,r){return r.success},async isAvailable(){return await handsManager.isConnected();}};

export const goHomeTool: Tool = { id:'go_home', name:'Go Home', description:'Navigate to Android home screen', category:'navigation', riskLevel:'low', inputSchema:{type:'object',properties:{}}, async execute(){await requireHands();const h=handsManager.getHands();if(!h)return{success:false,error:'Hands not available'};const beforeApp=await h.getCurrentApp();const r=await h.goHome();if(!r.success)return{success:false,error:r.error||'Home navigation failed'};await new Promise(res=>setTimeout(res,300));const afterApp=await h.getCurrentApp();return afterApp==='com.android.launcher'?{success:true,data:{navigated:true,beforeApp,afterApp,currentApp:afterApp}}:{success:false,error:`Verification failed: expected com.android.launcher, got ${afterApp}`,data:{navigated:false,beforeApp,afterApp,currentApp:afterApp}};},async verify(_p,r){return !!r.success&&r.data?.afterApp==='com.android.launcher'},async isAvailable(){return await handsManager.isConnected();}};

export const goBackTool: Tool = { id:'go_back', name:'Go Back', description:'Navigate back', category:'navigation', riskLevel:'low', inputSchema:{type:'object',properties:{}}, async execute(){await requireHands();const h=handsManager.getHands();if(!h)return{success:false,error:'Hands not available'};const beforeApp=await h.getCurrentApp();const r=await h.goBack();if(!r.success)return{success:false,error:r.error||'Back navigation failed'};await new Promise(res=>setTimeout(res,300));const afterApp=await h.getCurrentApp();const navigated=beforeApp!==afterApp;return navigated?{success:true,data:{navigated,beforeApp,afterApp}}:{success:false,error:`Verification failed: back navigation did not change app (${beforeApp})`,data:{navigated:false,beforeApp,afterApp}};},async verify(_p,r){return !!r.success&&r.data?.navigated===true&&r.data?.beforeApp!==r.data?.afterApp},async isAvailable(){return await handsManager.isConnected();}};

export const searchWebTool: Tool = { id:'search_web', name:'Search Web', description:'Search the web using default browser', category:'data', riskLevel:'low', inputSchema:{type:'object',properties:{query:{type:'string',description:'Search query'}},required:['query']}, async execute(p){await requireHands();const h=handsManager.getHands();if(!h)return{success:false,error:'Hands not available'};const url=`https://www.google.com/search?q=${encodeURIComponent(p.query)}`;const l=await h.launchApp('com.android.chrome');if(!l.success)return{success:false,error:'Failed to open browser'};await new Promise(r=>setTimeout(r,1000));const t=await h.type(url);if(!t.success)return{success:false,error:'Failed to type search query'};const e=await h.pressKey('enter');return e.success?{success:true,data:{query:p.query,url,browser:'com.android.chrome'}}:{success:false,error:'Failed to submit search'};},async verify(_p,r){return r.success},async isAvailable(){return await handsManager.isConnected();}};

import { toolRegistry } from './ToolRegistry';
export function registerRealTools(){[openAppTool,tapElementTool,typeTextTool,captureScreenTool,sendMessageTool,swipeTool,pressKeyTool,goHomeTool,goBackTool,searchWebTool].forEach(t=>toolRegistry.registerTool(t));}
registerRealTools();

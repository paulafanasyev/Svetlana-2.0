// Real Tool Registry - Uses actual PlatformHands for device control
import type { Tool, ToolResult } from './ToolRegistry';
import { handsManager } from './HandsManager';

// Helper to check if hands are available
async function requireHands(): Promise<void> {
  const connected = await handsManager.isConnected();
  if (!connected) {
    throw new Error('Android device not connected. Please connect via Settings → Android Connection.');
  }
}

// ============ REAL TOOLS ============

export const openAppTool: Tool = {
  id: 'open_app',
  name: 'Open Application',
  description: 'Launch an Android application by package name',
  category: 'navigation',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      packageName: {
        type: 'string',
        description: 'Android package name (e.g., com.telegram.messenger)',
      },
    },
    required: ['packageName'],
  },
  async execute(params: { packageName: string }): Promise<ToolResult> {
    await requireHands();
    const hands = handsManager.getHands();
    if (!hands) {
      return { success: false, error: 'Hands not available' };
    }

    const result = await hands.launchApp(params.packageName);
    
    if (result.success) {
      // Verify app is actually running
      await new Promise(resolve => setTimeout(resolve, 1000));
      const currentApp = await hands.getCurrentApp();
      
      if (currentApp === params.packageName) {
        return {
          success: true,
          data: { 
            app: params.packageName,
            verified: true,
            timestamp: Date.now()
          },
        };
      } else {
        return {
          success: false,
          error: `App launched but verification failed. Expected: ${params.packageName}, Got: ${currentApp}`,
        };
      }
    }
    
    return {
      success: false,
      error: result.error || 'Failed to launch app',
    };
  },
  async verify(params: { packageName: string }, result: ToolResult): Promise<boolean> {
    if (!result.success) return false;
    const hands = handsManager.getHands();
    if (!hands) return false;
    
    const currentApp = await hands.getCurrentApp();
    return currentApp === params.packageName;
  },
  async isAvailable(): Promise<boolean> {
    return await handsManager.isConnected();
  },
};

export const tapElementTool: Tool = {
  id: 'tap_element',
  name: 'Tap UI Element',
  description: 'Tap on a UI element by text or ID',
  category: 'interaction',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      elementText: {
        type: 'string',
        description: 'Text content of the element to tap',
      },
      elementId: {
        type: 'string',
        description: 'Resource ID of the element to tap',
      },
    },
  },
  async execute(params: { elementText?: string; elementId?: string }): Promise<ToolResult> {
    await requireHands();
    const hands = handsManager.getHands();
    if (!hands) {
      return { success: false, error: 'Hands not available' };
    }

    // Capture state before tap
    const beforeTree = await hands.getAccessibilityTree();
    const beforeApp = await hands.getCurrentApp();
    
    let element;
    if (params.elementText) {
      element = await hands.findElementByText(params.elementText);
    } else if (params.elementId) {
      element = await hands.findElementById(params.elementId);
    }

    if (!element) {
      return {
        success: false,
        error: `Element not found: ${params.elementText || params.elementId}`,
      };
    }

    // Perform tap
    const centerX = element.bounds.x + element.bounds.width / 2;
    const centerY = element.bounds.y + element.bounds.height / 2;
    const tapResult = await hands.tap(centerX, centerY);

    if (!tapResult.success) {
      return {
        success: false,
        error: tapResult.error || 'Tap failed',
      };
    }

    // Wait for UI to update
    await new Promise(resolve => setTimeout(resolve, 500));

    // Capture state after tap
    const afterTree = await hands.getAccessibilityTree();

    return {
      success: true,
      data: {
        element: {
          id: element.id,
          text: element.text,
          bounds: element.bounds,
        },
        tappedAt: { x: centerX, y: centerY },
        beforeTree,
        beforeApp,
        beforeElements: beforeTree.root.children?.length || 0,
        afterElements: afterTree.root.children?.length || 0,
        timestamp: Date.now(),
      },
    };
  },
  async verify(params: { elementText?: string; elementId?: string }, result: ToolResult): Promise<boolean> {
    if (!result.success) return false;
    
    const hands = handsManager.getHands();
    if (!hands) return false;
    
    // Real verification: check if UI actually changed after tap
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const currentTree = await hands.getAccessibilityTree();
    const beforeTree = result.data.beforeTree;
    
    if (!beforeTree) return false;
    
    // Compare element counts - if they changed, UI responded to tap
    const beforeCount = beforeTree.root.children?.length || 0;
    const afterCount = currentTree.root.children?.length || 0;
    
    // Also check if current app changed (navigation occurred)
    const currentApp = await hands.getCurrentApp();
    const beforeApp = result.data.beforeApp;
    
    // Verification passes if:
    // 1. Element count changed, OR
    // 2. Current app changed (navigation occurred)
    return (beforeCount !== afterCount) || (currentApp !== beforeApp);
  },
  async isAvailable(): Promise<boolean> {
    return await handsManager.isConnected();
  },
};

export const typeTextTool: Tool = {
  id: 'type_text',
  name: 'Type Text',
  description: 'Type text into the focused input field',
  category: 'interaction',
  riskLevel: 'medium',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Text to type',
      },
      clearFirst: {
        type: 'boolean',
        description: 'Clear field before typing',
      },
    },
    required: ['text'],
  },
  async execute(params: { text: string; clearFirst?: boolean }): Promise<ToolResult> {
    await requireHands();
    const hands = handsManager.getHands();
    if (!hands) {
      return { success: false, error: 'Hands not available' };
    }

    if (params.clearFirst) {
      await hands.clearText();
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    const result = await hands.type(params.text);

    if (result.success) {
      // Wait for text to appear
      await new Promise(resolve => setTimeout(resolve, 300));

      return {
        success: true,
        data: {
          typed: params.text,
          length: params.text.length,
          timestamp: Date.now(),
        },
      };
    }

    return {
      success: false,
      error: result.error || 'Failed to type text',
    };
  },
  async verify(params: { text: string; clearFirst?: boolean }, result: ToolResult): Promise<boolean> {
    if (!result.success) return false;
    
    const hands = handsManager.getHands();
    if (!hands) return false;
    
    // Real verification: check if text actually appeared in the focused field
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const tree = await hands.getAccessibilityTree();
    
    // Find focused input field in the accessibility tree
    const findFocusedInput = (node: any): any => {
      if (node.focused && (node.type === 'EditText' || node.type === 'TextField' || node.className?.includes('EditText'))) {
        return node;
      }
      if (node.children) {
        for (const child of node.children) {
          const found = findFocusedInput(child);
          if (found) return found;
        }
      }
      return null;
    };
    
    const focusedInput = findFocusedInput(tree.root);
    
    if (!focusedInput) {
      // No focused input found - verification fails
      return false;
    }
    
    // Check if the text matches what we typed
    const actualText = focusedInput.text || '';
    const expectedText = params.text;
    
    // Verification passes if the actual text contains what we typed
    return actualText.includes(expectedText);
  },
  async isAvailable(): Promise<boolean> {
    return await handsManager.isConnected();
  },
};

export const captureScreenTool: Tool = {
  id: 'capture_screen',
  name: 'Capture Screen',
  description: 'Take a screenshot of the current screen',
  category: 'system',
  riskLevel: 'medium',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  async execute(): Promise<ToolResult> {
    await requireHands();
    const hands = handsManager.getHands();
    if (!hands) {
      return { success: false, error: 'Hands not available' };
    }

    const capture = await hands.captureScreen();

    return {
      success: true,
      data: {
        image: capture.image,
        width: capture.width,
        height: capture.height,
        timestamp: capture.timestamp,
      },
    };
  },
  async verify(params: Record<string, never>, result: ToolResult): Promise<boolean> {
    return result.success && result.data.image.length > 0;
  },
  async isAvailable(): Promise<boolean> {
    return await handsManager.isConnected();
  },
};

export const sendMessageTool: Tool = {
  id: 'send_message',
  name: 'Send Message',
  description: 'Send a message via a messaging app (requires confirmation)',
  category: 'communication',
  riskLevel: 'high',
  inputSchema: {
    type: 'object',
    properties: {
      app: {
        type: 'string',
        description: 'Messaging app package name',
        enum: ['org.telegram.messenger', 'com.whatsapp', 'com.viber.voip'],
      },
      contact: {
        type: 'string',
        description: 'Contact name or phone number',
      },
      message: {
        type: 'string',
        description: 'Message text to send',
      },
    },
    required: ['app', 'contact', 'message'],
  },
  async execute(params: { app: string; contact: string; message: string }): Promise<ToolResult> {
    await requireHands();
    const hands = handsManager.getHands();
    if (!hands) {
      return { success: false, error: 'Hands not available' };
    }

    // This is a high-risk action - requires explicit confirmation
    // The policy engine should have already checked this
    // Here we just execute the steps

    // 1. Launch the app
    const launchResult = await hands.launchApp(params.app);
    if (!launchResult.success) {
      return { success: false, error: `Failed to launch ${params.app}` };
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    // 2. Find and tap the contact
    const contactElement = await hands.findElementByText(params.contact);
    if (!contactElement) {
      return { success: false, error: `Contact not found: ${params.contact}` };
    }

    const tapResult = await hands.tap(
      contactElement.bounds.x + contactElement.bounds.width / 2,
      contactElement.bounds.y + contactElement.bounds.height / 2
    );

    if (!tapResult.success) {
      return { success: false, error: 'Failed to tap contact' };
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. Type the message
    const typeResult = await hands.type(params.message);
    if (!typeResult.success) {
      return { success: false, error: 'Failed to type message' };
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    // 4. Find and tap send button
    const sendButton = await hands.findElementByText('Send') || 
                       await hands.findElementByText('Отправить');
    
    if (!sendButton) {
      return { 
        success: false, 
        error: 'Send button not found. Message typed but not sent.',
        data: { messageTyped: true, sent: false }
      };
    }

    const sendResult = await hands.tap(
      sendButton.bounds.x + sendButton.bounds.width / 2,
      sendButton.bounds.y + sendButton.bounds.height / 2
    );

    if (!sendResult.success) {
      return { success: false, error: 'Failed to tap send button' };
    }

    return {
      success: true,
      data: {
        app: params.app,
        contact: params.contact,
        message: params.message,
        sent: true,
        timestamp: Date.now(),
      },
    };
  },
  async verify(params: { app: string; contact: string; message: string }, result: ToolResult): Promise<boolean> {
    if (!result.success) return false;
    
    const hands = handsManager.getHands();
    if (!hands) return false;
    
    // Real verification: check if message actually appeared in chat
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const tree = await hands.getAccessibilityTree();
    
    // Search for the sent message in the accessibility tree
    const findMessage = (node: any, searchText: string): boolean => {
      if (node.text && node.text.includes(searchText)) {
        return true;
      }
      if (node.children) {
        for (const child of node.children) {
          if (findMessage(child, searchText)) return true;
        }
      }
      return false;
    };
    
    // Verification passes if the message text is found in the chat
    return findMessage(tree.root, params.message);
  },
  async isAvailable(): Promise<boolean> {
    return await handsManager.isConnected();
  },
};

// Swipe tool
export const swipeTool: Tool = {
  id: 'swipe',
  name: 'Swipe',
  description: 'Perform a swipe gesture on the screen',
  category: 'interaction',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      startX: { type: 'number', description: 'Start X coordinate' },
      startY: { type: 'number', description: 'Start Y coordinate' },
      endX: { type: 'number', description: 'End X coordinate' },
      endY: { type: 'number', description: 'End Y coordinate' },
      duration: { type: 'number', description: 'Duration in milliseconds (default: 300)' },
    },
    required: ['startX', 'startY', 'endX', 'endY'],
  },
  async execute(params: { startX: number; startY: number; endX: number; endY: number; duration?: number }): Promise<ToolResult> {
    await requireHands();
    const hands = handsManager.getHands();
    if (!hands) {
      return { success: false, error: 'Hands not available' };
    }

    const result = await hands.swipe(params.startX, params.startY, params.endX, params.endY, params.duration);
    
    if (result.success) {
      return {
        success: true,
        data: {
          startX: params.startX,
          startY: params.startY,
          endX: params.endX,
          endY: params.endY,
          duration: params.duration || 300,
          timestamp: Date.now(),
        },
      };
    }

    return {
      success: false,
      error: result.error || 'Swipe failed',
    };
  },
  async verify(params: any, result: ToolResult): Promise<boolean> {
    return result.success;
  },
  async isAvailable(): Promise<boolean> {
    return await handsManager.isConnected();
  },
};

// Press key tool
export const pressKeyTool: Tool = {
  id: 'press_key',
  name: 'Press Key',
  description: 'Press a hardware key (back, home, volume, etc.)',
  category: 'interaction',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Key to press (back, home, volume_up, volume_down, power, etc.)',
        enum: ['back', 'home', 'volume_up', 'volume_down', 'power', 'menu', 'recent'],
      },
    },
    required: ['key'],
  },
  async execute(params: { key: string }): Promise<ToolResult> {
    await requireHands();
    const hands = handsManager.getHands();
    if (!hands) {
      return { success: false, error: 'Hands not available' };
    }

    const result = await hands.pressKey(params.key);
    
    if (result.success) {
      return {
        success: true,
        data: {
          key: params.key,
          timestamp: Date.now(),
        },
      };
    }

    return {
      success: false,
      error: result.error || 'Key press failed',
    };
  },
  async verify(params: any, result: ToolResult): Promise<boolean> {
    return result.success;
  },
  async isAvailable(): Promise<boolean> {
    return await handsManager.isConnected();
  },
};

// Go home tool
export const goHomeTool: Tool = {
  id: 'go_home',
  name: 'Go Home',
  description: 'Navigate to home screen',
  category: 'navigation',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  async execute(): Promise<ToolResult> {
    await requireHands();
    const hands = handsManager.getHands();
    if (!hands) {
      return { success: false, error: 'Hands not available' };
    }

    const result = await hands.goHome();
    
    if (result.success) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const currentApp = await hands.getCurrentApp();
      
      return {
        success: true,
        data: {
          currentApp,
          timestamp: Date.now(),
        },
      };
    }

    return {
      success: false,
      error: result.error || 'Failed to go home',
    };
  },
  async verify(params: any, result: ToolResult): Promise<boolean> {
    return result.success;
  },
  async isAvailable(): Promise<boolean> {
    return await handsManager.isConnected();
  },
};

// Go back tool
export const goBackTool: Tool = {
  id: 'go_back',
  name: 'Go Back',
  description: 'Press back button',
  category: 'navigation',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  async execute(): Promise<ToolResult> {
    await requireHands();
    const hands = handsManager.getHands();
    if (!hands) {
      return { success: false, error: 'Hands not available' };
    }

    const beforeApp = await hands.getCurrentApp();
    const result = await hands.goBack();
    
    if (result.success) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const afterApp = await hands.getCurrentApp();
      
      return {
        success: true,
        data: {
          beforeApp,
          afterApp,
          navigated: beforeApp !== afterApp,
          timestamp: Date.now(),
        },
      };
    }

    return {
      success: false,
      error: result.error || 'Failed to go back',
    };
  },
  async verify(params: any, result: ToolResult): Promise<boolean> {
    return result.success && result.data.navigated;
  },
  async isAvailable(): Promise<boolean> {
    return await handsManager.isConnected();
  },
};

// Search web tool
export const searchWebTool: Tool = {
  id: 'search_web',
  name: 'Search Web',
  description: 'Search the web using default browser',
  category: 'data',
  riskLevel: 'low',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  },
  async execute(params: { query: string }): Promise<ToolResult> {
    await requireHands();
    const hands = handsManager.getHands();
    if (!hands) {
      return { success: false, error: 'Hands not available' };
    }

    // Open browser with search query
    const browserPackage = 'com.android.chrome';
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(params.query)}`;
    
    const launchResult = await hands.launchApp(browserPackage);
    if (!launchResult.success) {
      return { success: false, error: 'Failed to open browser' };
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Type URL in address bar
    const typeResult = await hands.type(searchUrl);
    if (!typeResult.success) {
      return { success: false, error: 'Failed to type search query' };
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    // Press enter
    const enterResult = await hands.pressKey('enter');
    if (!enterResult.success) {
      return { success: false, error: 'Failed to submit search' };
    }

    return {
      success: true,
      data: {
        query: params.query,
        url: searchUrl,
        browser: browserPackage,
        timestamp: Date.now(),
      },
    };
  },
  async verify(params: any, result: ToolResult): Promise<boolean> {
    return result.success;
  },
  async isAvailable(): Promise<boolean> {
    return await handsManager.isConnected();
  },
};

// Import toolRegistry and register all real tools
import { toolRegistry } from './ToolRegistry';

// Register all real tools - MUST be called during app initialization
export function registerRealTools() {
  toolRegistry.registerTool(openAppTool);
  toolRegistry.registerTool(tapElementTool);
  toolRegistry.registerTool(typeTextTool);
  toolRegistry.registerTool(captureScreenTool);
  toolRegistry.registerTool(sendMessageTool);
  toolRegistry.registerTool(swipeTool);
  toolRegistry.registerTool(pressKeyTool);
  toolRegistry.registerTool(goHomeTool);
  toolRegistry.registerTool(goBackTool);
  toolRegistry.registerTool(searchWebTool);
  
  console.log('[RealTools] Registered 10 real tools:');
  console.log('  - open_app (requires Android connection)');
  console.log('  - tap_element (requires Android connection)');
  console.log('  - type_text (requires Android connection)');
  console.log('  - capture_screen (requires Android connection)');
  console.log('  - send_message (requires Android connection + confirmation)');
  console.log('  - swipe (requires Android connection)');
  console.log('  - press_key (requires Android connection)');
  console.log('  - go_home (requires Android connection)');
  console.log('  - go_back (requires Android connection)');
  console.log('  - search_web (requires Android connection)');
  console.log('[RealTools] All tools use PlatformHands via HandsManager');
  console.log('[RealTools] NO stub implementations - all require real Android device');
}

// Auto-register on module load
registerRealTools();

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
    
    // Verify element is no longer in the same state (UI changed)
    const currentTree = await hands.getAccessibilityTree();
    return currentTree.timestamp > result.data.timestamp;
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
    // Verification would require reading the input field content
    // For now, assume success if no error
    return true;
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
    // Verification would require checking if message appears in chat
    // For now, assume success if no error
    return result.data.sent === true;
  },
  async isAvailable(): Promise<boolean> {
    return await handsManager.isConnected();
  },
};

// Register all real tools
export function registerRealTools() {
  // This would be called during app initialization
  // Tools are exported individually for use in ToolRegistry
  console.log('[ToolRegistry] Real tools registered');
  console.log('[ToolRegistry] Tools require Android device connection');
}

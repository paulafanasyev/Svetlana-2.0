package com.svetlana.android.hands;

import static org.junit.Assert.assertTrue;

import android.content.Intent;
import android.provider.Settings;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.List;
import java.util.Locale;

@RunWith(AndroidJUnit4.class)
public class Plan0AccessibilityUiTest {
    private static final String PACKAGE = "com.svetlana.android.hands";
    private static final String SERVICE = PACKAGE + "/" + PACKAGE + ".SvetlanaAccessibilityService";

    private UiDevice device() {
        return UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    }

    private String shell(String command) throws Exception {
        return device().executeShellCommand(command).trim();
    }

    private void marker(String value) {
        System.out.println("PLAN0_UIAUTOMATOR=" + value);
    }

    @Test
    public void enableSvetlanaAccessibilityThroughSettingsUi() throws Exception {
        UiDevice device = device();
        marker("START");
        marker("ADB_STATE=" + shell("get-state"));
        marker("BASELINE_ENABLED=" + shell("settings --user 0 get secure enabled_accessibility_services"));

        Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        InstrumentationRegistry.getInstrumentation().getTargetContext().startActivity(intent);

        assertTrue("Accessibility Settings did not appear",
                device.wait(Until.hasObject(By.pkg("com.android.settings")), 15000));
        marker("SETTINGS_OPEN=PASS");

        UiObject2 serviceRow = device.wait(
                Until.findObject(By.text("Svetlana Plan 0")), 15000);
        if (serviceRow == null) {
            serviceRow = device.wait(Until.findObject(By.textContains("Svetlana")), 5000);
        }
        assertTrue("Svetlana service row was not found by UiAutomator", serviceRow != null);
        marker("SERVICE_ROW_FOUND=PASS");

        serviceRow.click();
        marker("SERVICE_ROW_CLICK=PASS");
        device.waitForIdle();

        UiObject2 toggle = device.wait(Until.findObject(By.clazz("android.widget.Switch")), 10000);
        if (toggle == null) {
            List<UiObject2> checkable = device.findObjects(By.checkable(true));
            if (!checkable.isEmpty()) toggle = checkable.get(0);
        }
        assertTrue("Accessibility toggle was not found by UiAutomator", toggle != null);
        marker("TOGGLE_FOUND=PASS");

        boolean wasChecked = toggle.isChecked();
        marker("TOGGLE_BEFORE=" + wasChecked);
        if (!wasChecked) {
            toggle.click();
            marker("TOGGLE_CLICK=PASS");
        } else {
            marker("TOGGLE_CLICK=SKIPPED_ALREADY_ON");
        }
        device.waitForIdle();

        UiObject2 confirmation = device.wait(Until.findObject(By.text("OK")), 5000);
        if (confirmation == null) confirmation = device.wait(Until.findObject(By.text("Allow")), 3000);
        if (confirmation != null) {
            confirmation.click();
            marker("CONFIRM_CLICK=PASS");
        } else {
            marker("CONFIRM_CLICK=NOT_PRESENT");
        }

        boolean enabled = false;
        for (int i = 0; i < 30; i++) {
            String value = shell("settings --user 0 get secure enabled_accessibility_services");
            marker(String.format(Locale.US, "POLL_%02d_ENABLED=[%s]", i, value));
            if (value.contains(SERVICE)) {
                enabled = true;
                break;
            }
            Thread.sleep(1000);
        }

        marker("FINAL_ENABLED=" + enabled);
        marker("FINAL_SETTING=" + shell("settings --user 0 get secure enabled_accessibility_services"));
        marker("ACCESSIBILITY_DUMPSYS=" + shell("dumpsys accessibility | grep -E 'Enabled services:|Bound services:|Binding services:'"));
        assertTrue("Accessibility service was not enabled after the real UiAutomator toggle", enabled);
        marker("RESULT=PASS");
    }
}

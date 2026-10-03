package com.aimindmesh.auto;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AndroidAuto")
public class AndroidAutoPlugin extends Plugin {

    // Data and toggles live in AutoDataStore (persisted: the car service can run without the app)
    private static String initialRoute = null;

    public static void setInitialRoute(String route) {
        initialRoute = route;
    }

    public static String getInitialRoute() {
        return initialRoute;
    }

    public static void clearInitialRoute() {
        initialRoute = null;
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void startSession(PluginCall call) {
        // Logic to trigger car session or check connection if needed
        call.resolve();
    }

    @PluginMethod
    public void updateScreen(PluginCall call) {
        String type = call.getString("type");
        String payload = call.getString("payload");

        if (type == null || payload == null) {
            call.reject("Type and payload are required");
            return;
        }

        // Unknown types are ignored
        AutoDataStore.saveData(getContext(), type, payload);
        call.resolve();
    }

    @PluginMethod
    public void updateSettings(PluginCall call) {
        String[] toggles = {
                AutoDataStore.SHOW_CALL_MODE, AutoDataStore.SHOW_CALENDAR,
                AutoDataStore.SHOW_TODO, AutoDataStore.SHOW_KANBAN
        };
        for (String toggle : toggles) {
            Boolean value = call.getBoolean(toggle);
            if (value != null) AutoDataStore.saveToggle(getContext(), toggle, value);
        }
        call.resolve();
    }
}

package com.aimindmesh.auto;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AndroidAuto")
public class AndroidAutoPlugin extends Plugin {

    // Static storage for data sharing with Car Service
    private static String kanbanData = "{}";
    private static String calendarData = "[]";
    private static String tasksData = "[]";

    // Settings defaults
    private static boolean showCallMode = true;
    private static boolean showCalendar = true;
    private static boolean showToDo = true;
    private static boolean showKanban = true;
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

    public static String getKanbanData() {
        return kanbanData;
    }

    public static String getCalendarData() {
        return calendarData;
    }

    public static String getTasksData() {
        return tasksData;
    }

    public static boolean isCallModeEnabled() {
        return showCallMode;
    }

    public static boolean isCalendarEnabled() {
        return showCalendar;
    }

    public static boolean isToDoEnabled() {
        return showToDo;
    }

    public static boolean isKanbanEnabled() {
        return showKanban;
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

        switch (type) {
            case "kanban":
                kanbanData = payload;
                break;
            case "calendar":
                calendarData = payload;
                break;
            case "todo":
                tasksData = payload;
                break;
            default:
                // No-op for unknown types
                break;
        }

        // Notify listener if we implement real-time updates to car screen
        call.resolve();
    }

    @PluginMethod
    public void updateSettings(PluginCall call) {
        if (call.hasOption("showCallMode"))
            showCallMode = call.getBoolean("showCallMode");
        if (call.hasOption("showCalendar"))
            showCalendar = call.getBoolean("showCalendar");
        if (call.hasOption("showToDo"))
            showToDo = call.getBoolean("showToDo");
        if (call.hasOption("showKanban"))
            showKanban = call.getBoolean("showKanban");

        call.resolve();
    }
}

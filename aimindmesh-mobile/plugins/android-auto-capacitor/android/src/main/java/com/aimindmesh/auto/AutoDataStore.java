package com.aimindmesh.auto;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import androidx.car.app.Screen;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;

/**
 * Data and section toggles shown in the car, persisted in SharedPreferences: Android Auto can
 * start the car service in a fresh process (app killed), where only the phone app's JS could
 * have filled in-memory fields. Open screens are invalidated when the app pushes new data.
 */
public final class AutoDataStore {
    private static final String PREFS = "aimindmesh_android_auto";
    private static final String KEY_KANBAN = "data_kanban";
    private static final String KEY_CALENDAR = "data_calendar";
    private static final String KEY_TODO = "data_todo";
    public static final String SHOW_CALL_MODE = "showCallMode";
    public static final String SHOW_CALENDAR = "showCalendar";
    public static final String SHOW_TODO = "showToDo";
    public static final String SHOW_KANBAN = "showKanban";

    private static final List<WeakReference<Screen>> screens = new ArrayList<>();
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());

    private AutoDataStore() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** @return false for an unknown type */
    public static boolean saveData(Context context, String type, String payload) {
        String key;
        switch (type) {
            case "kanban":
                key = KEY_KANBAN;
                break;
            case "calendar":
                key = KEY_CALENDAR;
                break;
            case "todo":
                key = KEY_TODO;
                break;
            default:
                return false;
        }
        prefs(context).edit().putString(key, payload).apply();
        invalidateScreens();
        return true;
    }

    public static void saveToggle(Context context, String toggle, boolean value) {
        prefs(context).edit().putBoolean(toggle, value).apply();
        invalidateScreens();
    }

    public static String getKanbanData(Context context) {
        return prefs(context).getString(KEY_KANBAN, "{}");
    }

    public static String getCalendarData(Context context) {
        return prefs(context).getString(KEY_CALENDAR, "[]");
    }

    public static String getTasksData(Context context) {
        return prefs(context).getString(KEY_TODO, "[]");
    }

    /** Sections are shown until the app says otherwise */
    public static boolean isEnabled(Context context, String toggle) {
        return prefs(context).getBoolean(toggle, true);
    }

    /** A screen showing store data: redrawn when the data changes */
    public static void register(Screen screen) {
        synchronized (screens) {
            screens.add(new WeakReference<>(screen));
        }
    }

    private static void invalidateScreens() {
        List<Screen> alive = new ArrayList<>();
        synchronized (screens) {
            for (int i = screens.size() - 1; i >= 0; i--) {
                Screen screen = screens.get(i).get();
                if (screen == null) screens.remove(i);
                else alive.add(screen);
            }
        }
        // Screen.invalidate() is a no-op for screens not started (not on top)
        mainHandler.post(() -> {
            for (Screen screen : alive) screen.invalidate();
        });
    }
}

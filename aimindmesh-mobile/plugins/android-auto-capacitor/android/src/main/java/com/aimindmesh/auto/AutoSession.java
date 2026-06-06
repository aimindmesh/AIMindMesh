package com.aimindmesh.auto;

import android.content.Intent;
import androidx.annotation.NonNull;
import androidx.car.app.Screen;
import androidx.car.app.Session;

public class AutoSession extends Session {
    @NonNull
    @Override
    public Screen onCreateScreen(@NonNull Intent intent) {
        String initialRoute = AndroidAutoPlugin.getInitialRoute();
        AndroidAutoPlugin.clearInitialRoute();

        if ("kanban".equals(initialRoute)) {
            return new KanbanScreen(getCarContext());
        } else if ("call".equals(initialRoute)) {
            return new CallModeScreen(getCarContext());
        } else if ("agenda".equals(initialRoute)) {
            return new ToDoScreen(getCarContext());
        }

        return new MainScreen(getCarContext());
    }
}

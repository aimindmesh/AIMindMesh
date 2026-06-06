package com.aimindmesh.auto;

import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.ListTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;
import androidx.car.app.model.Action;
import androidx.annotation.NonNull;

public class AppInterfaceScreen extends Screen {
    public AppInterfaceScreen(CarContext carContext) {
        super(carContext);
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        ItemList.Builder listBuilder = new ItemList.Builder();

        listBuilder.addItem(
                new Row.Builder()
                        .setTitle("Calendar")
                        .setOnClickListener(() -> {
                            getScreenManager().push(new CalendarScreen(getCarContext()));
                        })
                        .build());

        listBuilder.addItem(
                new Row.Builder()
                        .setTitle("To-Do List")
                        .setOnClickListener(() -> {
                            getScreenManager().push(new ToDoScreen(getCarContext()));
                        })
                        .build());

        // Placeholder for Call Mode toggle/status
        listBuilder.addItem(
                new Row.Builder()
                        .setTitle("Call Mode")
                        .addText("Status: Standby")
                        .setOnClickListener(() -> {
                            // TODO: Toggle call mode or show status
                        })
                        .build());

        return new ListTemplate.Builder()
                .setSingleList(listBuilder.build())
                .setTitle("App Interface")
                .setHeaderAction(Action.BACK)
                .build();
    }
}

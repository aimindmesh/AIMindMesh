package com.aimindmesh.auto;

import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.ListTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;
import androidx.car.app.model.CarIcon;
import androidx.core.graphics.drawable.IconCompat;
import androidx.annotation.NonNull;

import java.util.List;
import java.util.Map;

public class ToDoScreen extends Screen {
    public ToDoScreen(CarContext carContext) {
        super(carContext);
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        ItemList.Builder listBuilder = new ItemList.Builder();

        String json = AndroidAutoPlugin.getTasksData();
        List<Map<String, String>> tasks = AutoUtils.parseTasks(json);

        if (tasks.isEmpty()) {
            listBuilder.addItem(new Row.Builder().setTitle("No tasks").build());
        } else {
            for (Map<String, String> task : tasks) {
                boolean isCompleted = Boolean.parseBoolean(task.get("isCompleted"));
                // Use a checkmark icon if completed, simple dot or circle if not
                int iconResId = isCompleted ? android.R.drawable.checkbox_on_background
                        : android.R.drawable.checkbox_off_background;

                listBuilder.addItem(
                        new Row.Builder()
                                .setTitle(task.get("text"))
                                .setImage(new CarIcon.Builder(IconCompat.createWithResource(getCarContext(), iconResId))
                                        .build())
                                .build());
            }
        }

        return new ListTemplate.Builder()
                .setTitle("Tasks")
                .setSingleList(listBuilder.build())
                .setHeaderAction(Action.BACK)
                .build();
    }
}

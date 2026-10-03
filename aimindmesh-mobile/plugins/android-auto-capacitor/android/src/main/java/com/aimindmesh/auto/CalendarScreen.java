package com.aimindmesh.auto;

import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.ListTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;
import androidx.annotation.NonNull;

import java.util.List;
import java.util.Map;

public class CalendarScreen extends Screen {
    public CalendarScreen(CarContext carContext) {
        super(carContext);
        AutoDataStore.register(this);
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        ItemList.Builder listBuilder = new ItemList.Builder();

        String json = AutoDataStore.getCalendarData(getCarContext());
        List<Map<String, String>> events = AutoUtils.parseCalendarEvents(json);

        if (events.isEmpty()) {
            listBuilder.addItem(new Row.Builder().setTitle("No upcoming events").build());
        } else {
            for (Map<String, String> event : events) {
                // All-day events come without an end time
                String end = event.get("endTime");
                String timeRange = end == null || end.isEmpty()
                        ? event.get("startTime")
                        : event.get("startTime") + " - " + end;
                Row.Builder row = new Row.Builder()
                        .setTitle(AutoUtils.nonEmpty(event.get("title"), "Untitled event"));
                if (timeRange != null && !timeRange.isEmpty()) row.addText(timeRange);
                String description = event.get("description");
                if (description != null && !description.isEmpty()) row.addText(description);
                listBuilder.addItem(row.build());
            }
        }

        return new ListTemplate.Builder()
                .setTitle("Calendar")
                .setSingleList(listBuilder.build())
                .setHeaderAction(Action.BACK)
                .build();
    }
}

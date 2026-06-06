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
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        ItemList.Builder listBuilder = new ItemList.Builder();

        String json = AndroidAutoPlugin.getCalendarData();
        List<Map<String, String>> events = AutoUtils.parseCalendarEvents(json);

        if (events.isEmpty()) {
            listBuilder.addItem(new Row.Builder().setTitle("No upcoming events").build());
        } else {
            for (Map<String, String> event : events) {
                String timeRange = event.get("startTime") + " - " + event.get("endTime");
                listBuilder.addItem(
                        new Row.Builder()
                                .setTitle(event.get("title"))
                                .addText(timeRange)
                                .addText(event.get("description"))
                                .build());
            }
        }

        return new ListTemplate.Builder()
                .setTitle("Calendar")
                .setSingleList(listBuilder.build())
                .setHeaderAction(Action.BACK)
                .build();
    }
}

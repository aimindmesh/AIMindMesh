package com.aimindmesh.auto;

import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.ListTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.SectionedItemList;
import androidx.car.app.model.Template;
import androidx.annotation.NonNull;

import java.util.List;
import java.util.Map;

public class KanbanScreen extends Screen {
    public KanbanScreen(CarContext carContext) {
        super(carContext);
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        ListTemplate.Builder listTemplateBuilder = new ListTemplate.Builder();
        listTemplateBuilder.setTitle("Kanban Board");
        listTemplateBuilder.setHeaderAction(Action.BACK);

        String json = AndroidAutoPlugin.getKanbanData();
        List<Map<String, Object>> columns = AutoUtils.parseKanbanColumns(json);

        if (columns.isEmpty()) {
            ItemList.Builder noDataBuilder = new ItemList.Builder();
            noDataBuilder.addItem(new Row.Builder().setTitle("No Kanban data").build());
            listTemplateBuilder.setSingleList(noDataBuilder.build());
        } else {
            for (Map<String, Object> column : columns) {
                String title = (String) column.get("title");
                List<Map<String, String>> tasks = (List<Map<String, String>>) column.get("tasks");

                ItemList.Builder sectionBuilder = new ItemList.Builder();
                if (tasks == null || tasks.isEmpty()) {
                    sectionBuilder.addItem(new Row.Builder().setTitle("Empty").build());
                } else {
                    for (Map<String, String> task : tasks) {
                        sectionBuilder.addItem(
                                new Row.Builder()
                                        .setTitle(task.get("content"))
                                        .build());
                    }
                }

                listTemplateBuilder.addSectionedList(
                        SectionedItemList.create(
                                sectionBuilder.build(),
                                title));
            }
        }

        return listTemplateBuilder.build();
    }
}

package com.aimindmesh.auto;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class AutoUtils {

    public static List<Map<String, String>> parseCalendarEvents(String json) {
        List<Map<String, String>> events = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(json);
            for (int i = 0; i < array.length(); i++) {
                JSONObject obj = array.getJSONObject(i);
                Map<String, String> event = new HashMap<>();
                event.put("title", obj.optString("title", "No Title"));
                event.put("startTime", obj.optString("startTime", ""));
                event.put("endTime", obj.optString("endTime", ""));
                event.put("description", obj.optString("description", ""));
                events.add(event);
            }
        } catch (JSONException e) {
            e.printStackTrace();
        }
        return events;
    }

    public static List<Map<String, String>> parseTasks(String json) {
        List<Map<String, String>> tasks = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(json);
            for (int i = 0; i < array.length(); i++) {
                JSONObject obj = array.getJSONObject(i);
                Map<String, String> task = new HashMap<>();
                task.put("id", obj.optString("id", ""));
                task.put("text", obj.optString("text", ""));
                task.put("isCompleted", String.valueOf(obj.optBoolean("completed", false)));
                tasks.add(task);
            }
        } catch (JSONException e) {
            e.printStackTrace();
        }
        return tasks;
    }

    public static List<Map<String, Object>> parseKanbanColumns(String json) {
        List<Map<String, Object>> columns = new ArrayList<>();
        try {
            JSONObject board = new JSONObject(json);
            if (board.has("columns")) {
                JSONObject columnsObj = board.getJSONObject("columns");
                // Iterate keys to get columns. Or assumes 'columnOrder' exists if structure
                // matches standard drag-drop
                if (board.has("columnOrder")) {
                    JSONArray order = board.getJSONArray("columnOrder");
                    for (int i = 0; i < order.length(); i++) {
                        String colId = order.getString(i);
                        if (columnsObj.has(colId)) {
                            JSONObject col = columnsObj.getJSONObject(colId);
                            Map<String, Object> column = new HashMap<>();
                            column.put("id", colId);
                            column.put("title", col.optString("title", "Untitled"));

                            List<Map<String, String>> tasks = new ArrayList<>();
                            JSONArray taskIds = col.optJSONArray("taskIds");
                            if (taskIds != null && board.has("tasks")) {
                                JSONObject allTasks = board.getJSONObject("tasks");
                                for (int j = 0; j < taskIds.length(); j++) {
                                    String taskId = taskIds.getString(j);
                                    if (allTasks.has(taskId)) {
                                        JSONObject t = allTasks.getJSONObject(taskId);
                                        Map<String, String> taskMap = new HashMap<>();
                                        taskMap.put("content", t.optString("content", ""));
                                        tasks.add(taskMap);
                                    }
                                }
                            }
                            column.put("tasks", tasks);
                            columns.add(column);
                        }
                    }
                }
            }
        } catch (JSONException e) {
            e.printStackTrace();
        }
        return columns;
    }
}

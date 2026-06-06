package com.aimindmesh.auto;

import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.CarColor;
import androidx.car.app.model.CarIcon;
import androidx.car.app.model.GridItem;
import androidx.car.app.model.GridTemplate;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.Template;
import androidx.core.graphics.drawable.IconCompat;
import androidx.annotation.NonNull;

public class MainScreen extends Screen {
        public MainScreen(CarContext carContext) {
                super(carContext);
        }

        @NonNull
        @Override
        public Template onGetTemplate() {
                ItemList.Builder listBuilder = new ItemList.Builder();

                // Call Mode Item
                if (AndroidAutoPlugin.isCallModeEnabled()) {
                        listBuilder.addItem(
                                        new GridItem.Builder()
                                                        .setTitle("Assistant Call")
                                                        .setImage(new CarIcon.Builder(
                                                                        IconCompat.createWithResource(getCarContext(),
                                                                                        android.R.drawable.ic_btn_speak_now))
                                                                        .build())
                                                        .setOnClickListener(() -> {
                                                                // Start Call Mode / Voice Service
                                                                // Assuming Call Mode is triggered via an Activity or
                                                                // Service start
                                                                // For now, let's open the CallModeActivity from the
                                                                // main app if possible,
                                                                // or trigger the functionality via the plugin bridge if
                                                                // the app is foreground.
                                                                // But better: Use the ConversationScreen which mimics
                                                                // "Call Mode" in Auto
                                                                getScreenManager().push(
                                                                                new CallModeScreen(getCarContext()));
                                                        })
                                                        .build());
                }

                // Calendar Item
                if (AndroidAutoPlugin.isCalendarEnabled()) {
                        listBuilder.addItem(
                                        new GridItem.Builder()
                                                        .setTitle("Calendar")
                                                        .setImage(new CarIcon.Builder(IconCompat.createWithResource(
                                                                        getCarContext(),
                                                                        android.R.drawable.ic_menu_my_calendar))
                                                                        .build())
                                                        .setOnClickListener(() -> getScreenManager()
                                                                        .push(new CalendarScreen(getCarContext())))
                                                        .build());
                }

                // To-Do Item
                if (AndroidAutoPlugin.isToDoEnabled()) {
                        listBuilder.addItem(
                                        new GridItem.Builder()
                                                        .setTitle("Agenda")
                                                        .setImage(new CarIcon.Builder(
                                                                        IconCompat.createWithResource(getCarContext(),
                                                                                        android.R.drawable.ic_menu_agenda))
                                                                        .build())
                                                        .setOnClickListener(() -> getScreenManager()
                                                                        .push(new ToDoScreen(getCarContext())))
                                                        .build());
                }

                // Kanban Item
                if (AndroidAutoPlugin.isKanbanEnabled()) {
                        listBuilder.addItem(
                                        new GridItem.Builder()
                                                        .setTitle("Kanban Board")
                                                        .setImage(new CarIcon.Builder(IconCompat.createWithResource(
                                                                        getCarContext(),
                                                                        android.R.drawable.ic_menu_sort_by_size))
                                                                        .build())
                                                        .setOnClickListener(() -> getScreenManager()
                                                                        .push(new KanbanScreen(getCarContext())))
                                                        .build());
                }

                return new GridTemplate.Builder()
                                .setSingleList(listBuilder.build())
                                .setTitle("AMM Mobile")
                                .build();
        }
}

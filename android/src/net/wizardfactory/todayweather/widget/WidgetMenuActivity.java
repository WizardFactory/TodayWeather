package net.wizardfactory.todayweather.widget;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;

import net.wizardfactory.todayweather.MainActivity;
import net.wizardfactory.todayweather.R;
import net.wizardfactory.todayweather.widget.Provider.W2x1WidgetProvider;

import org.apache.cordova.CordovaActivity;

/**
 * This class is menu of widget
 * used common all widget.
 */
public class WidgetMenuActivity extends CordovaActivity {
    private Context mContxt = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        mContxt = getApplicationContext();

        setContentView(R.layout.widget_menu);
    }

    @Override
    protected void onResume() {
        super.onResume();

        LinearLayout mainLayout = (LinearLayout)findViewById(R.id.menu_layout);
        mainLayout.setOnClickListener(new View.OnClickListener() {
            public void onClick(View arg0) {
                finish();
            }
        });

        // update widget button
        Button updateBtn = (Button)findViewById(R.id.update_button);
        updateBtn.setOnClickListener(new View.OnClickListener() {
            public void onClick(View arg0) {
                updateWidget();
            }
        });

        // move main page button
        Button moveMainBtn = (Button)findViewById(R.id.move_main_button);
        moveMainBtn.setOnClickListener(new View.OnClickListener() {
            public void onClick(View arg0) {
                moveMain();
            }
        });
    }

    private void updateWidget() {
        Intent intent = new Intent(this, W2x1WidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        ComponentName thisWidget = new ComponentName(mContxt, W2x1WidgetProvider.class);
        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(mContxt);
        int[] appWidgetIds = appWidgetManager.getAppWidgetIds(thisWidget);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, appWidgetIds);
        sendBroadcast(intent);

        finish();
    }

    private void moveMain() {
        Intent intent = new Intent(mContxt, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        mContxt.startActivity(intent);
        finish();
    }
}

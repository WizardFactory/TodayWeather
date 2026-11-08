package net.wizardfactory.todayweather

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.Operation
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf

/**
 * Registers a token FCM delivered (`onNewToken`) as WorkManager work, so the replacement completes even when the
 * process ends first: WorkManager keeps the work and runs it in a later process. Tokens queue in order of arrival
 * (one unique chain), and [TodayWeatherApp.push] keeps them apart from the start registration.
 */
class PushTokenWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val token = inputData.getString(TOKEN) ?: return Result.failure()
        val app = applicationContext as TodayWeatherApp
        app.migration.await()
        app.push.onNewToken(token)
        // A failed request is not retried, as in the Cordova app; the next start posts the list with this token.
        return Result.success()
    }

    companion object {
        const val WORK = "push-token"
        private const val TOKEN = "token"

        fun enqueue(context: Context, token: String): Operation = WorkManager.getInstance(context).enqueueUniqueWork(
            WORK,
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            OneTimeWorkRequestBuilder<PushTokenWorker>().setInputData(workDataOf(TOKEN to token)).build(),
        )
    }
}

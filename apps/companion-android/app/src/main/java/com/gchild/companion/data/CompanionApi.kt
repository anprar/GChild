package com.gchild.companion.data

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

sealed interface ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>
    data class HttpError(val status: Int, val code: String, val message: String) : ApiResult<Nothing>
    data class NetworkError(val message: String) : ApiResult<Nothing>
    data class InvalidResponse(val message: String) : ApiResult<Nothing>
}

/**
 * Klien HTTP ke backend GChild. Tidak ada endpoint Parent di sini: kanal Parent
 * adalah bot Telegram, sedangkan Companion hanya memakai endpoint device-self.
 */
class CompanionApi(
    private val baseUrl: String,
    private val client: OkHttpClient = defaultClient(),
) {
    val isConfigured: Boolean
        get() = baseUrl.startsWith("http://") || baseUrl.startsWith("https://")

    suspend fun claim(
        code: String,
        deviceSecret: String,
        label: String,
        installationId: String,
        appVersion: String,
        sdkInt: Int,
    ): ApiResult<ClaimResponse> = withContext(Dispatchers.IO) {
        post(
            path = "/v1/enrollment/claim",
            body = CompanionJson.buildClaimBody(
                code = code,
                deviceSecret = deviceSecret,
                label = label,
                installationId = installationId,
                appVersion = appVersion,
                sdkInt = sdkInt,
            ),
        ).mapBody(CompanionJson::parseClaimResponse)
    }

    suspend fun confirmLocal(
        enrollmentId: String,
        claimToken: String,
        accepted: Boolean,
    ): ApiResult<EnrollmentStatus> = withContext(Dispatchers.IO) {
        post(
            path = "/v1/enrollment/$enrollmentId/confirm-local",
            body = CompanionJson.buildConfirmLocalBody(accepted),
            headers = mapOf("X-Enrollment-Token" to claimToken),
        ).mapBody(CompanionJson::parseEnrollmentStatus)
    }

    suspend fun getEnrollment(
        enrollmentId: String,
        claimToken: String,
    ): ApiResult<EnrollmentStatus> = withContext(Dispatchers.IO) {
        get(
            path = "/v1/enrollment/$enrollmentId",
            headers = mapOf("X-Enrollment-Token" to claimToken),
        ).mapBody(CompanionJson::parseEnrollmentStatus)
    }

    suspend fun fetchCommands(credential: String): ApiResult<List<DeviceCommand>> =
        withContext(Dispatchers.IO) {
            get(
                path = "/v1/device-self/commands?limit=10",
                headers = deviceHeaders(credential),
            ).mapBody(CompanionJson::parseCommandList)
        }

    suspend fun ack(
        credential: String,
        commandId: String,
        body: String,
    ): ApiResult<AckResult> = withContext(Dispatchers.IO) {
        post(
            path = "/v1/device-self/commands/$commandId/ack",
            body = body,
            headers = deviceHeaders(credential),
        ).mapBody(CompanionJson::parseAckResponse)
    }

    suspend fun postStatus(credential: String, body: String): ApiResult<Unit> =
        withContext(Dispatchers.IO) {
            post(
                path = "/v1/device-self/status",
                body = body,
                headers = deviceHeaders(credential),
            ).mapBody { }
        }

    private fun deviceHeaders(credential: String): Map<String, String> =
        mapOf("Authorization" to "Device $credential")

    private fun get(path: String, headers: Map<String, String> = emptyMap()): ApiResult<String> {
        if (!isConfigured) return ApiResult.NetworkError(SERVER_NOT_CONFIGURED)
        val builder = Request.Builder().url("$baseUrl$path").get()
        headers.forEach { (name, value) -> builder.header(name, value) }
        return execute(builder.build())
    }

    private fun post(
        path: String,
        body: String,
        headers: Map<String, String> = emptyMap(),
    ): ApiResult<String> {
        if (!isConfigured) return ApiResult.NetworkError(SERVER_NOT_CONFIGURED)
        val builder = Request.Builder()
            .url("$baseUrl$path")
            .post(body.toRequestBody(JSON_MEDIA_TYPE))
        headers.forEach { (name, value) -> builder.header(name, value) }
        return execute(builder.build())
    }

    private fun execute(request: Request): ApiResult<String> = try {
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (response.isSuccessful) {
                ApiResult.Ok(text)
            } else {
                val error = CompanionJson.parseError(text)
                ApiResult.HttpError(
                    status = response.code,
                    code = error?.code ?: "HTTP_${response.code}",
                    message = error?.message ?: "Permintaan gagal (HTTP ${response.code}).",
                )
            }
        }
    } catch (error: IOException) {
        ApiResult.NetworkError(
            "Tidak dapat menghubungi server: ${error.message ?: "jaringan bermasalah"}",
        )
    }

    private inline fun <T> ApiResult<String>.mapBody(parse: (String) -> T): ApiResult<T> =
        when (this) {
            is ApiResult.Ok -> try {
                ApiResult.Ok(parse(value))
            } catch (error: Exception) {
                ApiResult.InvalidResponse(
                    "Respons server tidak sesuai kontrak: ${error.message ?: "field tidak dikenali"}",
                )
            }
            is ApiResult.HttpError -> this
            is ApiResult.NetworkError -> this
            is ApiResult.InvalidResponse -> this
        }

    private companion object {
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        const val SERVER_NOT_CONFIGURED =
            "Server belum dikonfigurasi pada build ini. Hubungi pengelola build."

        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .callTimeout(30, TimeUnit.SECONDS)
            .build()
    }
}

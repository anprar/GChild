package com.gchild.companion.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.gchild.companion.data.ApprovalOutcome
import com.gchild.companion.data.CompanionRepository
import com.gchild.companion.data.ConsentOutcome
import com.gchild.companion.data.PairOutcome
import com.gchild.companion.data.StatusSnapshot
import com.gchild.companion.data.SyncOutcome
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface CompanionUiState {
    data object Loading : CompanionUiState

    data object Onboarding : CompanionUiState

    data class Pairing(val busy: Boolean = false, val error: String? = null) : CompanionUiState

    data class Consent(
        val verificationCode: String,
        val deviceLabel: String,
        val busy: Boolean = false,
        val message: String? = null,
    ) : CompanionUiState

    data class Ready(
        val deviceLabel: String?,
        val serverConfigured: Boolean,
        val snapshot: StatusSnapshot? = null,
        val busy: Boolean = false,
        val message: String? = null,
    ) : CompanionUiState
}

class CompanionViewModel(private val repository: CompanionRepository) : ViewModel() {
    private val _state = MutableStateFlow<CompanionUiState>(CompanionUiState.Loading)
    val state = _state.asStateFlow()

    init {
        when {
            repository.hasPendingClaim() -> checkApproval()
            repository.hasActivePairing() -> {
                _state.value = CompanionUiState.Ready(
                    deviceLabel = repository.deviceLabel(),
                    serverConfigured = repository.serverConfigured,
                    message = "Mengirim status awal…",
                )
                refreshStatus()
            }

            else -> _state.value = CompanionUiState.Onboarding
        }
    }

    fun startPairing() {
        _state.value = CompanionUiState.Pairing()
    }

    fun pair(code: String, label: String) {
        if (_state.value !is CompanionUiState.Pairing) return
        if (!code.matches(Regex("\\d{8}"))) {
            _state.value = CompanionUiState.Pairing(error = "Kode pairing harus 8 digit.")
            return
        }
        if (label.isBlank()) {
            _state.value = CompanionUiState.Pairing(error = "Nama perangkat wajib diisi.")
            return
        }

        _state.value = CompanionUiState.Pairing(busy = true)
        viewModelScope.launch {
            when (val outcome = repository.claim(code, label.trim())) {
                is PairOutcome.Claimed -> _state.value = CompanionUiState.Consent(
                    verificationCode = outcome.verificationCode,
                    deviceLabel = outcome.deviceLabel,
                )

                is PairOutcome.Failed -> _state.value = CompanionUiState.Pairing(error = outcome.message)
            }
        }
    }

    fun confirmLocal() {
        val current = _state.value as? CompanionUiState.Consent ?: return
        _state.value = current.copy(busy = true, message = null)
        viewModelScope.launch {
            when (val outcome = repository.confirmLocal(accepted = true)) {
                ConsentOutcome.Accepted -> _state.value = current.copy(
                    busy = false,
                    message = "Persetujuan lokal terkirim. Minta orang tua menyetujui di bot Telegram, lalu tekan \"Cek persetujuan\".",
                )

                is ConsentOutcome.Failed -> _state.value = current.copy(busy = false, message = outcome.message)
            }
        }
    }

    fun denyPairing() {
        val current = _state.value as? CompanionUiState.Consent ?: return
        _state.value = current.copy(busy = true)
        viewModelScope.launch {
            repository.confirmLocal(accepted = false)
            _state.value = CompanionUiState.Pairing(
                error = "Persetujuan lokal ditolak. Tidak ada data yang dikirim ke orang tua.",
            )
        }
    }

    fun checkApproval() {
        val current = _state.value
        val code = repository.pendingVerificationCode().orEmpty()
        val label = repository.deviceLabel().orEmpty()
        if (current is CompanionUiState.Consent) {
            _state.value = current.copy(busy = true, message = null)
        }

        viewModelScope.launch {
            when (val outcome = repository.checkApproval()) {
                is ApprovalOutcome.Approved -> _state.value = CompanionUiState.Ready(
                    deviceLabel = outcome.deviceLabel,
                    serverConfigured = repository.serverConfigured,
                    message = "Perangkat disetujui. Status akan dikirim ke orang tua.",
                )

                is ApprovalOutcome.Waiting -> _state.value = CompanionUiState.Consent(
                    verificationCode = code,
                    deviceLabel = label,
                    message = "Belum disetujui orang tua (status ${outcome.status}). Cocokkan kode verifikasi di bot Telegram.",
                )

                is ApprovalOutcome.Closed -> _state.value = CompanionUiState.Pairing(error = outcome.message)
            }
        }
    }

    fun refreshStatus() {
        val current = _state.value as? CompanionUiState.Ready ?: return
        _state.value = current.copy(busy = true, message = "Mengirim status…")
        viewModelScope.launch {
            when (val outcome = repository.sendStatus()) {
                is SyncOutcome.Ok -> _state.value = current.copy(
                    busy = false,
                    snapshot = outcome.snapshot ?: current.snapshot,
                    message = outcome.message,
                )

                is SyncOutcome.Failed -> _state.value = if (outcome.revoked) {
                    CompanionUiState.Pairing(error = outcome.message)
                } else {
                    current.copy(busy = false, message = outcome.message)
                }
            }
        }
    }

    fun checkCommands() {
        val current = _state.value as? CompanionUiState.Ready ?: return
        _state.value = current.copy(busy = true, message = "Memeriksa perintah…")
        viewModelScope.launch {
            when (val outcome = repository.checkCommands()) {
                is SyncOutcome.Ok -> _state.value = current.copy(busy = false, message = outcome.message)
                is SyncOutcome.Failed -> _state.value = if (outcome.revoked) {
                    CompanionUiState.Pairing(error = outcome.message)
                } else {
                    current.copy(busy = false, message = outcome.message)
                }
            }
        }
    }

    fun forgetDevice() {
        repository.forgetDevice()
        _state.value = CompanionUiState.Onboarding
    }

    companion object {
        fun factory(repository: CompanionRepository) = viewModelFactory {
            initializer { CompanionViewModel(repository) }
        }
    }
}

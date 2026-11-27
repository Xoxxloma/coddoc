package org.seedvault.service

import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.ResponseStatus

@ResponseStatus(HttpStatus.NOT_FOUND) class NotFound(what: String) : RuntimeException("$what не найден")
@ResponseStatus(HttpStatus.CONFLICT) class Conflict(why: String) : RuntimeException(why)
@ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY) class Invalid(why: String) : RuntimeException(why)

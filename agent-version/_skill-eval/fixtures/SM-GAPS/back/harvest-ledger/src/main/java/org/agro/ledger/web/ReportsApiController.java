package org.agro.ledger.web;

import java.time.LocalDate;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.ReportsApi;
import org.agro.ledger.api.model.Digest;
import org.agro.ledger.service.DigestService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class ReportsApiController implements ReportsApi {

  private final DigestService service;

  @Override
  @PreAuthorize("hasRole('HEAD_AGRONOMIST')")
  public ResponseEntity<Digest> getWeeklyDigest(LocalDate weekStart) {
    return ResponseEntity.ok(service.weekly(weekStart));
  }
}

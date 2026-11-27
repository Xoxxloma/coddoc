package org.agro.ledger.web;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.ProfileApi;
import org.agro.ledger.api.model.Me;
import org.agro.ledger.api.model.Unit;
import org.agro.ledger.security.CurrentUser;
import org.agro.ledger.service.ProfileService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class ProfileApiController implements ProfileApi {

  private final ProfileService service;

  @Override
  public ResponseEntity<Me> getMe() {
    return ResponseEntity.ok(service.me(CurrentUser.number()));
  }

  @Override
  public ResponseEntity<List<Unit>> getScope() {
    return ResponseEntity.ok(service.scope(CurrentUser.number()).stream().map(SummaryApiController::unit).toList());
  }
}

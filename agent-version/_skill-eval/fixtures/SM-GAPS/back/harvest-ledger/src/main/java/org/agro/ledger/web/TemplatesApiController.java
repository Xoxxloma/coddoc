package org.agro.ledger.web;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.TemplatesApi;
import org.agro.ledger.api.model.Template;
import org.agro.ledger.domain.Crop;
import org.agro.ledger.domain.MeasurementTemplate;
import org.agro.ledger.security.CurrentUser;
import org.agro.ledger.service.TemplateService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class TemplatesApiController implements TemplatesApi {

  private final TemplateService service;

  @Override
  @PreAuthorize("hasAnyRole('HEAD_AGRONOMIST', 'METHODIST')")
  public ResponseEntity<List<Template>> listTemplates() {
    return ResponseEntity.ok(service.list(CurrentUser.number()).stream().map(this::dto).toList());
  }

  @Override
  @PreAuthorize("hasRole('HEAD_AGRONOMIST')")
  public ResponseEntity<Void> createTemplate(Template body) {
    service.create(CurrentUser.number(), body);
    return ResponseEntity.status(HttpStatus.CREATED).build();
  }

  @Override
  @PreAuthorize("hasRole('HEAD_AGRONOMIST')")
  public ResponseEntity<List<String>> checkAssignments(List<String> agronomists) {
    return ResponseEntity.ok(service.alreadyAssigned(agronomists));
  }

  @Override
  @PreAuthorize("hasAnyRole('HEAD_AGRONOMIST', 'METHODIST')")
  public ResponseEntity<Template> getTemplate(Long id) {
    return ResponseEntity.ok(dto(service.get(id)));
  }

  @Override
  @PreAuthorize("hasRole('HEAD_AGRONOMIST')")
  public ResponseEntity<Void> updateTemplate(Long id, Template body) {
    service.update(CurrentUser.number(), id, body);
    return ResponseEntity.noContent().build();
  }

  @Override
  @PreAuthorize("hasRole('HEAD_AGRONOMIST')")
  public ResponseEntity<Void> deleteTemplate(Long id) {
    service.delete(CurrentUser.number(), id);
    return ResponseEntity.noContent().build();
  }

  @Override
  @PreAuthorize("hasRole('HEAD_AGRONOMIST')")
  public ResponseEntity<Void> assignTemplate(Long id, List<String> body) {
    service.addAssignees(CurrentUser.number(), id, body);
    return ResponseEntity.noContent().build();
  }

  @Override
  @PreAuthorize("hasRole('HEAD_AGRONOMIST')")
  public ResponseEntity<Void> unassignTemplate(Long id, String agronomist) {
    service.removeAssignee(CurrentUser.number(), id, agronomist);
    return ResponseEntity.noContent().build();
  }

  private Template dto(MeasurementTemplate t) {
    Template d = new Template();
    d.setId(t.getId());
    d.setName(t.getName());
    d.setCropIds(t.getCrops().stream().map(Crop::getId).toList());
    d.setAgronomists(service.assignees(t.getId()));
    return d;
  }
}

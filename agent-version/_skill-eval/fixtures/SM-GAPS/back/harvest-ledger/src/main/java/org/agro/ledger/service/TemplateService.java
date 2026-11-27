package org.agro.ledger.service;

import java.util.HashSet;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.model.Template;
import org.agro.ledger.domain.MeasurementTemplate;
import org.agro.ledger.domain.TemplateAssignment;
import org.agro.ledger.repository.CropRepository;
import org.agro.ledger.repository.TemplateAssignmentRepository;
import org.agro.ledger.repository.TemplateRepository;
import org.agro.ledger.security.CurrentUser;
import org.agro.ledger.security.LedgerRole;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class TemplateService {

  private final TemplateRepository templates;
  private final TemplateAssignmentRepository assignments;
  private final CropRepository crops;
  private final AuditPublisher audit;

  /** Главный агроном видит свои шаблоны, методист — все. */
  public List<MeasurementTemplate> list(String number) {
    return CurrentUser.has(LedgerRole.METHODIST) ? templates.findAll() : templates.findByOwnerNumber(number);
  }

  public MeasurementTemplate get(long id) {
    return templates.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
  }

  public List<String> assignees(long id) {
    return assignments.findByTemplateId(id).stream().map(TemplateAssignment::getAgronomistNumber).toList();
  }

  public List<String> alreadyAssigned(List<String> numbers) {
    return assignments.findByAgronomistNumberIn(numbers).stream().map(TemplateAssignment::getAgronomistNumber).toList();
  }

  @Transactional
  public MeasurementTemplate create(String owner, Template body) {
    if (assignments.existsByAgronomistNumberIn(body.getAgronomists())) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "agronomist already has a template");
    }
    MeasurementTemplate t = new MeasurementTemplate();
    t.setName(body.getName());
    t.setOwnerNumber(owner);
    t.setCrops(new HashSet<>(crops.findAllById(body.getCropIds())));
    templates.save(t);
    body.getAgronomists().forEach(n -> assign(t, n));
    audit.templateChanged(owner, t.getId(), "CREATED");
    return t;
  }

  /** Править может только автор шаблона. */
  @Transactional
  public void update(String actor, long id, Template body) {
    MeasurementTemplate t = own(actor, id);
    t.setName(body.getName());
    t.setCrops(new HashSet<>(crops.findAllById(body.getCropIds())));
    audit.templateChanged(actor, id, "UPDATED");
  }

  @Transactional
  public void addAssignees(String actor, long id, List<String> numbers) {
    MeasurementTemplate t = own(actor, id);
    if (assignments.existsByAgronomistNumberIn(numbers)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "agronomist already has a template");
    }
    numbers.forEach(n -> assign(t, n));
  }

  @Transactional
  public void removeAssignee(String actor, long id, String agronomist) {
    own(actor, id);
    assignments.deleteByTemplateIdAndAgronomistNumber(id, agronomist);
  }

  @Transactional
  public void delete(String actor, long id) {
    templates.deleteById(id);
    audit.templateChanged(actor, id, "DELETED");
  }

  private MeasurementTemplate own(String actor, long id) {
    MeasurementTemplate t = get(id);
    if (!t.getOwnerNumber().equals(actor)) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "not your template");
    }
    return t;
  }

  private void assign(MeasurementTemplate t, String number) {
    TemplateAssignment a = new TemplateAssignment();
    a.setTemplate(t);
    a.setAgronomistNumber(number);
    assignments.save(a);
  }
}

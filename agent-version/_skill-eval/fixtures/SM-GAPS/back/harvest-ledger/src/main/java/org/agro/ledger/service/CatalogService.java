package org.agro.ledger.service;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.model.CropUsage;
import org.agro.ledger.domain.Crop;
import org.agro.ledger.domain.CropGroup;
import org.agro.ledger.repository.CropGroupRepository;
import org.agro.ledger.repository.CropRepository;
import org.agro.ledger.repository.EntryValueRepository;
import org.agro.ledger.repository.TemplateRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class CatalogService {

  private final CropRepository crops;
  private final CropGroupRepository groups;
  private final EntryValueRepository values;
  private final TemplateRepository templates;

  public List<Crop> all() {
    return crops.findAll();
  }

  @Transactional
  public Crop create(String code, String name, Long groupId) {
    if (crops.existsByCode(code)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "code taken");
    }
    Crop c = new Crop();
    c.setCode(code);
    c.setName(name);
    c.setGroup(group(groupId));
    return crops.save(c);
  }

  /** Код культуры не меняется — по нему строятся столбцы сводки; меняются имя и группа. */
  @Transactional
  public void rename(long id, String name, Long groupId) {
    Crop c = crops.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    c.setName(name);
    c.setGroup(group(groupId));
  }

  /** Значения этой культуры в уже сохранённых замерах удаляются вместе с ней (каскад в БД). */
  @Transactional
  public void delete(long id) {
    crops.deleteById(id);
  }

  public CropUsage usage(long id) {
    CropUsage u = new CropUsage();
    u.setValues((int) values.countByCropId(id));
    u.setTemplates((int) templates.countUsingCrop(id));
    return u;
  }

  private CropGroup group(Long groupId) {
    return groupId == null ? null
        : groups.findById(groupId).orElseThrow(() -> new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "no such group"));
  }
}

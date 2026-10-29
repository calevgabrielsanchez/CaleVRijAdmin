import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MenteComponent } from './mente.component';

describe('MenteComponent', () => {
  let component: MenteComponent;
  let fixture: ComponentFixture<MenteComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MenteComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MenteComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
